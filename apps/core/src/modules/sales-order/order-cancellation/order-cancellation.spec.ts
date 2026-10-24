import { Logger } from '@nestjs/common';
import { OrderCancellation } from './order-cancellation';
import * as capability from './channel-cancellation-capability';
import type { CancellationRequest } from './order-cancellation.types';
import {
  PrintInProductionError,
  PrintOrderCancellationManager,
  PrintPartialCancelAvailableError,
} from '../../print-order/services/print-order-cancellation.manager';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';
import { BadRequestError } from '@app/shared';
import type { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import type { OrderCancellationReader } from './order-cancellation.reader';
import type { CancellationRefundManager } from '../cancellation-refund/cancellation-refund.manager';

const PRINTED = { vendorCancelled: ['po-1'], locallyCancelled: [] };
const PARTIAL_META = {
  cancellationScope: 'partial',
  refundEstimateAmount: 2000,
  manualReason: 'PROPORTIONAL_ESTIMATE',
};
const VIEW = { id: 'req-1', status: 'settling', scope: 'full', convertedFromFull: false };

function makeKernel(
  options: {
    salesChannel?: string;
    noSalesOrder?: boolean;
    replayView?: Record<string, unknown> | null;
    printRows?: Array<Record<string, unknown>>;
    planLines?: Array<{ salesOrderLineId: string; quantity: number }>;
    printCancel?: jest.Mock;
    activePrint?: boolean;
    followUp?: string | null;
    cancelError?: Error;
    soStatus?: string;
    /** core 정산 주문 — 같은 키 재전송 판정 결과 */
    coreReplay?: boolean;
    /** 커밋 뒤 즉시 환불 실행 결과. Error 면 던진다 */
    executeResult?: string | null | Error;
  } = {},
) {
  const callOrder: string[] = [];
  const so = { id: 'so', salesChannel: options.salesChannel ?? 'medusa', status: options.soStatus ?? 'confirmed' };
  // 커널이 여는 수신 트랜잭션(`DbService.run`)
  const { tx } = makeTx();
  const db = { run: jest.fn((fn: (trx: unknown) => Promise<unknown>) => fn(tx)) };
  const salesOrders = {
    planCancellation: jest.fn().mockResolvedValue({ lines: options.planLines ?? [] }),
    cancel: jest.fn(() => {
      callOrder.push('cancel');
      return options.cancelError ? Promise.reject(options.cancelError) : Promise.resolve(undefined);
    }),
    validateCancellationReplay: jest.fn().mockResolvedValue(options.coreReplay ?? false),
  };
  // 결제 쪽 매니저 — 방침별 기록은 매니저 spec 이 소유한다. 여기서는 «무엇을 넘기고 언제 실행하나»만 본다
  const refunds = {
    effectFor: jest.fn((policy: string, _so: unknown, effectLines: unknown[] | undefined) =>
      Promise.resolve(
        effectLines
          ? { externalRef: 'wallet:intent:i', refundStatus: 'manual_pending', metadata: PARTIAL_META }
          : policy === 'immediate'
            ? { externalRef: 'wallet:intent:i', refundStatus: 'requested', metadata: {} }
            : { externalRef: 'wallet:intent:i', refundStatus: 'manual_pending', metadata: { awaitingDecision: true } },
      ),
    ),
    executeRequested: jest.fn(() => {
      callOrder.push('execute');
      const result = options.executeResult === undefined ? 'succeeded' : options.executeResult;
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    }),
  };
  const cancelRequests = {
    findBySourceKey: jest.fn().mockResolvedValue(options.replayView ?? null),
    precheck: jest.fn(() => {
      callOrder.push('precheck');
      return Promise.resolve(undefined);
    }),
    request: jest.fn(() => {
      callOrder.push('request');
      return Promise.resolve(VIEW);
    }),
  };
  const printOrders = { forSalesOrder: jest.fn().mockResolvedValue(options.printRows ?? []) };
  const printCancel =
    options.printCancel ??
    jest.fn((_id: string, mode: string) => {
      callOrder.push(mode);
      return Promise.resolve(PRINTED);
    });
  const printNote = jest.fn().mockResolvedValue(undefined);
  const holdUnsent = jest.fn(() => {
    callOrder.push('holdUnsent');
    return Promise.resolve(undefined);
  });
  const holdForDecrease = jest.fn().mockResolvedValue(undefined);
  const settler = {
    settleCancelled: jest.fn(() => {
      callOrder.push('settleCancelled');
      return Promise.resolve(undefined);
    }),
  };
  const reader = {
    salesOrder: jest.fn().mockResolvedValue(options.noSalesOrder ? undefined : so),
    digitalLineIds: jest.fn().mockResolvedValue(new Set<string>()),
    hasActivePrintOrder: jest.fn().mockResolvedValue(options.activePrint ?? false),
    cancellationNeedsFollowUp: jest.fn().mockResolvedValue(options.followUp ?? null),
  };
  const k = new OrderCancellation(
    db as never,
    salesOrders as never,
    cancelRequests as never,
    printOrders as unknown as PrintOrderReader,
    {
      cancelForOrder: printCancel,
      noteSalesCancelFailed: printNote,
      holdUnsent,
      holdForDecrease,
    } as unknown as PrintOrderCancellationManager,
    settler as unknown as ChannelCancelSettler,
    reader as unknown as OrderCancellationReader,
    refunds as unknown as CancellationRefundManager,
  );
  return {
    k,
    refunds,
    db,
    tx,
    salesOrders,
    cancelRequests,
    printCancel,
    printNote,
    holdUnsent,
    holdForDecrease,
    settler,
    reader,
    callOrder,
  };
}

/** 문이 넘기는 바깥 트랜잭션. savepoint 는 콜백이 던지면 그 예외를 그대로 내보낸다(=되돌림) */
function makeTx() {
  const savepoint = { savepoint: true };
  const tx = { transaction: jest.fn((fn: (sp: unknown) => Promise<unknown>) => fn(savepoint)) };
  return { tx, savepoint };
}

const lines = [{ salesOrderLineId: 'line-1', quantity: 1 }];
const op: CancellationRequest = {
  requester: { kind: 'operator', actorId: 'a' },
  actorRoles: ['admin'],
  salesOrderId: 'so',
  sourceKey: 'k',
};

describe('OrderCancellation.request', () => {
  it('판매주문이 없으면 404', async () => {
    const { k } = makeKernel({ noSalesOrder: true });
    await expect(k.request(op)).rejects.toThrow('주문을 찾을 수 없습니다.');
  });

  it('판매자센터 주문은 키가 없어도 판매자센터 문구가 먼저다', async () => {
    const { k } = makeKernel({ salesChannel: 'naver' });
    await expect(k.request({ ...op, sourceKey: undefined })).rejects.toThrow('네이버 판매자센터에서 취소해 주세요.');
  });

  it('키가 없으면 400', async () => {
    const { k } = makeKernel({ salesChannel: 'medusa' });
    await expect(k.request({ ...op, sourceKey: undefined })).rejects.toThrow('Idempotency-Key header is required');
  });

  it('같은 키의 요청이 있으면 그 view 를 돌려주고 와우프레스를 부르지 않는다', async () => {
    const view = { id: 'req-0', status: 'applied', scope: 'full', convertedFromFull: false };
    const { k, cancelRequests, printCancel } = makeKernel({ replayView: view });
    expect(
      await k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' }),
    ).toEqual({ kind: 'channel_request', view });
    expect(printCancel).not.toHaveBeenCalled();
    expect(cancelRequests.request).not.toHaveBeenCalled();
  });

  it('운영자 요청은 precheck → gate → request 순서로, 상계 금액을 precheck 와 request 에 넘긴다', async () => {
    const { k, cancelRequests, printCancel, callOrder } = makeKernel();
    await k.request({ ...op, lines, alreadyRefundedAmount: 1000 });
    expect(callOrder).toEqual(['precheck', 'gate', 'request']);
    expect(cancelRequests.precheck).toHaveBeenCalledWith('so', lines, 1000);
    expect(printCancel).toHaveBeenCalledWith('so', 'gate', lines);
    expect(cancelRequests.request).toHaveBeenCalledWith(
      expect.objectContaining({ requester: { kind: 'operator', actorId: 'a' }, alreadyRefundedAmount: 1000 }),
    );
  });

  it('확정이 실패하면 인쇄 행에 남기고 다시 던진다', async () => {
    const { k, cancelRequests, printNote } = makeKernel();
    const boom = new Error('boom');
    cancelRequests.request.mockRejectedValue(boom);
    await expect(k.request(op)).rejects.toBe(boom);
    expect(printNote).toHaveBeenCalledWith(PRINTED, boom);
  });

  it('고객 요청은 거절을 남겨 두는 gate 를 부르고 상계 금액을 넘기지 않는다', async () => {
    const { k, cancelRequests, printCancel } = makeKernel();
    expect(
      await k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' }),
    ).toEqual({ kind: 'channel_request', view: VIEW });
    expect(cancelRequests.precheck).toHaveBeenCalledWith('so', undefined);
    expect(printCancel).toHaveBeenCalledWith('so', 'gate', undefined, { keepOnRefusal: true });
    expect(cancelRequests.request).toHaveBeenCalledWith({
      salesOrderId: 'so',
      requester: { kind: 'customer', customerId: 'c' },
      sourceKey: 'k',
      reasonCode: undefined,
      reasonDetail: undefined,
    });
  });

  it('고객 excludePrint 는 살아 있는 인쇄 줄을 뺀 계획을 줄로 쓴다', async () => {
    const { k, cancelRequests } = makeKernel({
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [
        { salesOrderLineId: 'print-line', quantity: 1 },
        { salesOrderLineId: 'normal-line', quantity: 2 },
      ],
    });
    await k.request({
      requester: { kind: 'customer', customerId: 'c' },
      salesOrderId: 'so',
      sourceKey: 'k',
      excludePrint: true,
    });
    expect(cancelRequests.request).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [{ salesOrderLineId: 'normal-line', quantity: 2 }] }),
    );
  });

  it('고객 excludePrint 인데 남은 게 인쇄뿐이면 제작 중 안내로 막는다', async () => {
    const { k, cancelRequests } = makeKernel({
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [{ salesOrderLineId: 'print-line', quantity: 1 }],
    });
    await expect(
      k.request({
        requester: { kind: 'customer', customerId: 'c' },
        salesOrderId: 'so',
        sourceKey: 'k',
        excludePrint: true,
      }),
    ).rejects.toBeInstanceOf(PrintInProductionError);
    expect(cancelRequests.precheck).not.toHaveBeenCalled();
  });

  it('고객 gate 가 제작 중으로 거절하고 다른 상품이 남으면 인쇄 제외 취소를 묻는다', async () => {
    const { k, cancelRequests } = makeKernel({
      printCancel: jest.fn().mockRejectedValue(new PrintInProductionError()),
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [
        { salesOrderLineId: 'print-line', quantity: 1 },
        { salesOrderLineId: 'normal-line', quantity: 2 },
      ],
    });
    await expect(
      k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' }),
    ).rejects.toBeInstanceOf(PrintPartialCancelAvailableError);
    expect(cancelRequests.request).not.toHaveBeenCalled();
  });

  it('운영자 gate 거절은 그대로 던진다 — 인쇄 제외 취소를 묻지 않는다', async () => {
    const { k } = makeKernel({
      printCancel: jest.fn().mockRejectedValue(new PrintInProductionError()),
      planLines: [{ salesOrderLineId: 'normal-line', quantity: 2 }],
    });
    await expect(k.request(op)).rejects.toBeInstanceOf(PrintInProductionError);
  });
});

describe('OrderCancellation.request — core 가 돈을 쥔 주문 (K7 PR4, D1·D2)', () => {
  const customer: CancellationRequest = {
    requester: { kind: 'customer', customerId: 'c' },
    salesOrderId: 'so',
    sourceKey: 'k',
    reasonCode: 'CUSTOMER_REQUEST',
  };

  it('core 정산 주문의 운영자 전체취소 — precheck → gate → cancel(walletRefund = effectFor(decide_later)) 순서, Wallet 실행 없음', async () => {
    const { k, tx, salesOrders, refunds, cancelRequests, printCancel, callOrder } = makeKernel({ salesChannel: '3pl' });
    const result = await k.request({ ...op, reasonCode: 'ADMIN', reasonDetail: '재고 없음' });
    expect(callOrder).toEqual(['precheck', 'gate', 'cancel']);
    expect(cancelRequests.precheck).toHaveBeenCalledWith('so', undefined, undefined);
    expect(printCancel).toHaveBeenCalledWith('so', 'gate', undefined);
    expect(refunds.effectFor).toHaveBeenCalledWith(
      'decide_later',
      expect.objectContaining({ id: 'so' }),
      undefined,
      'ADMIN',
      tx,
    );
    expect(salesOrders.cancel).toHaveBeenCalledWith(
      'so',
      {
        reasonCode: 'ADMIN',
        reasonDetail: '재고 없음',
        cancelledBy: 'admin',
        fulfillmentCommandContext: { idempotencyKey: 'k', actorId: 'a', actorRoles: ['admin'] },
        walletRefund: {
          externalRef: 'wallet:intent:i',
          refundStatus: 'manual_pending',
          metadata: { awaitingDecision: true },
        },
      },
      tx,
    );
    expect(refunds.executeRequested).not.toHaveBeenCalled();
    expect(cancelRequests.request).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'applied', scope: 'full', refund: { refundStatus: 'manual_pending' } });
  });

  it('core 정산 주문의 운영자 부분취소는 그 줄로 effectFor 를 묻고 추정액을 결과에 싣는다', async () => {
    const { k, tx, refunds, salesOrders } = makeKernel({ salesChannel: '3pl' });
    const result = await k.request({ ...op, lines });
    expect(refunds.effectFor).toHaveBeenCalledWith('decide_later', expect.anything(), lines, undefined, tx);
    expect(salesOrders.cancel).toHaveBeenCalledWith('so', expect.objectContaining({ lines }), tx);
    expect(result).toEqual({
      kind: 'applied',
      scope: 'partial',
      refund: { refundStatus: 'manual_pending', refundEstimateAmount: 2000, manualReason: 'PROPORTIONAL_ESTIMATE' },
    });
  });

  it('core 정산 주문의 고객 전체취소 — effectFor(immediate) 를 cancel 에 넘기고 커밋 뒤 executeRequested', async () => {
    const { k, db, tx, salesOrders, refunds, printCancel, callOrder } = makeKernel({ salesChannel: '3pl' });
    const result = await k.request(customer);
    expect(callOrder).toEqual(['precheck', 'gate', 'cancel', 'execute']);
    expect(printCancel).toHaveBeenCalledWith('so', 'gate', undefined, { keepOnRefusal: true });
    expect(refunds.effectFor).toHaveBeenCalledWith('immediate', expect.anything(), undefined, 'CUSTOMER_REQUEST', tx);
    expect(salesOrders.cancel).toHaveBeenCalledWith(
      'so',
      expect.objectContaining({
        cancelledBy: 'customer',
        fulfillmentCommandContext: { idempotencyKey: 'k', actorId: 'c', actorRoles: [] },
        walletRefund: expect.objectContaining({ refundStatus: 'requested' }),
      }),
      tx,
    );
    // 실행은 취소 트랜잭션이 끝난 «뒤» — 트랜잭션은 한 번(효과 기록 + 취소)이고 실행은 그 밖이다
    expect(refunds.executeRequested).toHaveBeenCalledWith('so');
    expect(db.run).toHaveBeenCalledTimes(2); // 주문 읽기 + 취소
    expect(result).toEqual({ kind: 'applied', scope: 'full', refund: { refundStatus: 'succeeded' } });
  });

  it('고객 excludePrint 부분취소는 effectFor 에 줄을 넘기고 실행하지 않는다', async () => {
    const { k, tx, refunds } = makeKernel({
      salesChannel: '3pl',
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [
        { salesOrderLineId: 'print-line', quantity: 1 },
        { salesOrderLineId: 'normal-line', quantity: 2 },
      ],
    });
    const result = await k.request({ ...customer, excludePrint: true });
    expect(refunds.effectFor).toHaveBeenCalledWith(
      'immediate',
      expect.anything(),
      [{ salesOrderLineId: 'normal-line', quantity: 2 }],
      'CUSTOMER_REQUEST',
      tx,
    );
    expect(refunds.executeRequested).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'applied', scope: 'partial', refund: { refundStatus: 'manual_pending' } });
  });

  it('고객 gate 가 제작 중으로 거절하고 다른 상품이 남으면 core 정산 주문도 인쇄 제외 취소를 묻는다', async () => {
    const { k, salesOrders } = makeKernel({
      salesChannel: '3pl',
      printCancel: jest.fn().mockRejectedValue(new PrintInProductionError()),
      printRows: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
      planLines: [
        { salesOrderLineId: 'print-line', quantity: 1 },
        { salesOrderLineId: 'normal-line', quantity: 2 },
      ],
    });
    await expect(k.request(customer)).rejects.toBeInstanceOf(PrintPartialCancelAvailableError);
    expect(salesOrders.cancel).not.toHaveBeenCalled();
  });

  it('커밋 뒤 실행이 던져도 결과는 applied, refundStatus 는 requested — 오류는 스택과 함께 로그에 남는다', async () => {
    const boom = new Error('wallet down');
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { k, salesOrders } = makeKernel({ salesChannel: '3pl', executeResult: boom });
      const result = await k.request(customer);
      expect(salesOrders.cancel).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: 'applied', scope: 'full', refund: { refundStatus: 'requested' } });
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('wallet down'), boom.stack);
    } finally {
      logError.mockRestore();
    }
  });

  it('cancel 이 core 인데 돈을 core 가 쥐지 않는 채널이면 던진다 — 환불 방침은 settlesMoney 로 정한다 (프로그램 결함)', async () => {
    const spy = jest.spyOn(capability, 'cancellationCapabilityOf').mockReturnValue({
      ...capability.CHANNEL_CANCELLATION_CAPABILITIES['3pl'],
      settlesMoney: 'channel',
    });
    try {
      const { k, salesOrders, refunds } = makeKernel({ salesChannel: '3pl' });
      await expect(k.request(op)).rejects.toThrow('settlesMoney');
      expect(refunds.effectFor).not.toHaveBeenCalled();
      expect(salesOrders.cancel).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('커밋 뒤 실행이 할 일이 없었으면(상자 후 대기 등) refundStatus 는 requested', async () => {
    const { k } = makeKernel({ salesChannel: '3pl', executeResult: null });
    expect(await k.request(customer)).toEqual({
      kind: 'applied',
      scope: 'full',
      refund: { refundStatus: 'requested' },
    });
  });

  it('cancel 이 던지면 noteSalesCancelFailed 뒤 다시 던지고 실행하지 않는다', async () => {
    const boom = new BadRequestError('이미 출고된 줄입니다.');
    const { k, printNote, refunds } = makeKernel({ salesChannel: '3pl', cancelError: boom });
    await expect(k.request(customer)).rejects.toBe(boom);
    expect(printNote).toHaveBeenCalledWith(PRINTED, boom);
    expect(refunds.executeRequested).not.toHaveBeenCalled();
  });

  it('같은 키 재전송은 validateCancellationReplay 가 true 면 replayed — gate·cancel 없음', async () => {
    const { k, salesOrders, printCancel, cancelRequests, refunds } = makeKernel({
      salesChannel: '3pl',
      coreReplay: true,
    });
    expect(await k.request({ ...op, lines, reasonCode: 'ADMIN' })).toEqual({ kind: 'replayed' });
    expect(salesOrders.validateCancellationReplay).toHaveBeenCalledWith('so', {
      sourceKey: 'k',
      reasonCode: 'ADMIN',
      reasonDetail: undefined,
      lines,
    });
    expect(cancelRequests.precheck).not.toHaveBeenCalled();
    expect(printCancel).not.toHaveBeenCalled();
    expect(salesOrders.cancel).not.toHaveBeenCalled();
    expect(refunds.effectFor).not.toHaveBeenCalled();
  });

  it('같은 키 재전송은 이미 취소된 주문이어도 400 이 아니다', async () => {
    const { k } = makeKernel({ salesChannel: '3pl', coreReplay: true, soStatus: 'cancelled' });
    expect(await k.request(op)).toEqual({ kind: 'replayed' });
  });

  it.each([
    ['cancelled', '이미 취소된 주문입니다.'],
    ['timeout', '타임아웃된 주문은 취소할 수 없습니다.'],
  ])('이미 취소/타임아웃이면 지금 문구로 400 (%s)', async (soStatus, message) => {
    const { k, printCancel } = makeKernel({ salesChannel: '3pl', soStatus });
    const refused = k.request(op);
    await expect(refused).rejects.toBeInstanceOf(BadRequestError);
    await expect(refused).rejects.toThrow(message);
    expect(printCancel).not.toHaveBeenCalled();
  });

  it('core 정산 주문에 alreadyRefundedAmount 를 적으면 400', async () => {
    const { k, printCancel } = makeKernel({ salesChannel: '3pl' });
    const refused = k.request({ ...op, lines, alreadyRefundedAmount: 1000 });
    await expect(refused).rejects.toBeInstanceOf(BadRequestError);
    await expect(refused).rejects.toThrow('이미 환불한 금액은 Medusa 주문 부분취소에만 적을 수 있습니다.');
    expect(printCancel).not.toHaveBeenCalled();
  });

  it('core 정산 주문도 키가 없으면 400', async () => {
    const { k, salesOrders } = makeKernel({ salesChannel: '3pl' });
    await expect(k.request({ ...op, sourceKey: undefined })).rejects.toThrow('Idempotency-Key header is required');
    expect(salesOrders.cancel).not.toHaveBeenCalled();
  });
});

describe('OrderCancellation 통보 — 채널 취소·무통장 승인·채널 수량 감소', () => {
  const t = new Date('2026-10-07T00:00:01.000Z');
  const view = VIEW;

  it('새 전체취소 — 한 트랜잭션에서 cancel → holdUnsent → settle, 커밋 뒤 record', async () => {
    const { k, db, tx, salesOrders, holdUnsent, settler, printCancel, callOrder } = makeKernel();
    const receive = jest.fn().mockResolvedValue({
      notice: { salesOrderId: 'so', lines: undefined, metadata: { sourceEventId: 'e' } },
    });
    await k.receiveChannelCancellation(receive);
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(tx);
    expect(callOrder).toEqual(['cancel', 'holdUnsent', 'settleCancelled', 'record']);
    expect(salesOrders.cancel).toHaveBeenCalledWith('so', { metadata: { sourceEventId: 'e' } }, tx);
    expect(holdUnsent).toHaveBeenCalledWith('so', undefined, tx);
    expect(settler.settleCancelled).toHaveBeenCalledWith('so', tx);
    expect(printCancel).toHaveBeenCalledWith('so', 'record', undefined, { redeliveredSince: undefined });
  });

  it('새 부분취소는 정산을 닫지 않고 그 줄만 record', async () => {
    const { k, tx, salesOrders, settler, printCancel, callOrder } = makeKernel();
    await k.receiveChannelCancellation(async () => ({
      notice: { salesOrderId: 'so', lines, reasonCode: 'CUSTOMER_REQUEST', metadata: {} },
    }));
    expect(callOrder).toEqual(['cancel', 'holdUnsent', 'record']);
    expect(settler.settleCancelled).not.toHaveBeenCalled();
    expect(salesOrders.cancel).toHaveBeenCalledWith(
      'so',
      expect.objectContaining({ lines, reasonCode: 'CUSTOMER_REQUEST' }),
      tx,
    );
    expect(printCancel).toHaveBeenCalledWith('so', 'record', lines, { redeliveredSince: undefined });
  });

  it('재수신은 취소하지 않고 record 에 처음 기록 시각을 넘긴다', async () => {
    const { k, salesOrders, holdUnsent, settler, printCancel } = makeKernel();
    await k.receiveChannelCancellation(async () => ({ redelivered: { salesOrderId: 'so', lines, since: t } }));
    expect(salesOrders.cancel).not.toHaveBeenCalled();
    expect(holdUnsent).not.toHaveBeenCalled();
    expect(settler.settleCancelled).not.toHaveBeenCalled();
    expect(printCancel).toHaveBeenCalledWith('so', 'record', lines, { redeliveredSince: t });
  });

  it('receive 가 null 이면 record 도 없다', async () => {
    const { k, salesOrders, printCancel } = makeKernel();
    await k.receiveChannelCancellation(async () => null);
    expect(salesOrders.cancel).not.toHaveBeenCalled();
    expect(printCancel).not.toHaveBeenCalled();
  });

  it('커밋 뒤 record 가 던지면 그대로 던진다 — 컨슈머 재시도가 재수신 경로로 다시 정리한다', async () => {
    const { k, salesOrders } = makeKernel({ printCancel: jest.fn().mockRejectedValue(new Error('wowpress down')) });
    await expect(
      k.receiveChannelCancellation(async () => ({ notice: { salesOrderId: 'so', lines: undefined, metadata: {} } })),
    ).rejects.toThrow('wowpress down');
    expect(salesOrders.cancel).toHaveBeenCalledTimes(1);
  });

  describe('무통장 승인', () => {
    const approval = { salesOrderId: 'so', intentId: 'i', reasonCode: 'CUSTOMER_REFUND_REQUEST' };

    it('확정과 안 보낸 인쇄 붙잡기를 한 트랜잭션에서, 커밋 뒤 record (D6)', async () => {
      const { k, db, tx, cancelRequests, holdUnsent, printCancel, callOrder } = makeKernel();
      const result = await k.noticeWalletRefundApproval(approval);
      expect(db.run).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['request', 'holdUnsent', 'record']);
      expect(cancelRequests.request).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: 'wallet-refund-approval:i',
          requester: { kind: 'wallet-refund-approval', intentId: 'i' },
          reasonCode: 'CUSTOMER_REFUND_REQUEST',
        }),
        tx,
      );
      expect(holdUnsent).toHaveBeenCalledWith('so', undefined, tx);
      expect(printCancel).toHaveBeenCalledWith('so', 'record');
      expect(result).toEqual(view);
    });

    it('확정이 실패하면 record 하지 않고 던진다', async () => {
      const { k, cancelRequests, printCancel } = makeKernel();
      // 동시 승인이 먼저 확정한 경우 — 붙잡기도 함께 롤백된다
      const refused = new BadRequestError('이미 취소된 주문입니다.');
      cancelRequests.request.mockImplementationOnce(() => Promise.reject(refused));
      await expect(k.noticeWalletRefundApproval(approval)).rejects.toBe(refused);
      expect(printCancel).not.toHaveBeenCalled();
    });

    it('커밋 뒤 record 가 던지면 그대로 던진다 (N8)', async () => {
      const { k, cancelRequests } = makeKernel({
        printCancel: jest.fn().mockRejectedValue(new Error('wowpress down')),
      });
      await expect(k.noticeWalletRefundApproval(approval)).rejects.toThrow('wowpress down');
      expect(cancelRequests.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('채널 수량 감소', () => {
    const line = { salesOrderLineId: 'line-1', quantity: 1 };
    const decrease = {
      salesOrderId: 'so',
      line,
      reasonCode: 'CHANNEL_ORDER_MODIFIED',
      occurredAt: '2026-10-07T00:00:00.000Z',
      sourceEventId: 'amend-1:line-1',
      attempt: true,
    };

    it('savepoint 안에서 그 줄만 채널 취소로 줄인다', async () => {
      const { k, salesOrders, reader } = makeKernel();
      const { tx, savepoint } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({ applied: true });
      expect(tx.transaction).toHaveBeenCalledTimes(1);
      expect(reader.hasActivePrintOrder).toHaveBeenCalledWith('line-1', savepoint);
      expect(salesOrders.cancel).toHaveBeenCalledWith(
        'so',
        {
          lines: [line],
          cancelledBy: 'channel',
          reasonCode: 'CHANNEL_ORDER_MODIFIED',
          occurredAt: '2026-10-07T00:00:00.000Z',
          metadata: { sourceEventId: 'amend-1:line-1' },
        },
        savepoint,
      );
      expect(reader.cancellationNeedsFollowUp).toHaveBeenCalledWith('so', 'amend-1:line-1', savepoint);
    });

    it('시도 전에 savepoint 밖에서 그 줄의 인쇄를 붙잡는다', async () => {
      const { k, holdForDecrease } = makeKernel();
      const { tx } = makeTx();
      await k.noticeChannelDecrease(decrease, tx as never);
      // 거절이 savepoint 를 되돌려도 붙잡기는 남아야 한다 — 바깥 tx 로, savepoint 를 열기 전에
      expect(holdForDecrease).toHaveBeenCalledWith('line-1', tx);
      expect(holdForDecrease.mock.invocationCallOrder[0]).toBeLessThan(tx.transaction.mock.invocationCallOrder[0]);
    });

    it('attempt: false 면 붙잡기만 하고 시도하지 않는다', async () => {
      const { k, holdForDecrease, salesOrders } = makeKernel();
      const { tx } = makeTx();
      const o = await k.noticeChannelDecrease({ ...decrease, attempt: false }, tx as never);
      expect(o).toEqual({ applied: false, refusal: 'deferred by the channel change rule' });
      expect(holdForDecrease).toHaveBeenCalledTimes(1);
      expect(holdForDecrease).toHaveBeenCalledWith('line-1', tx);
      expect(tx.transaction).not.toHaveBeenCalled();
      expect(salesOrders.cancel).not.toHaveBeenCalled();
    });

    it('인쇄 줄이면 취소하지 않고 거절한다', async () => {
      const { k, salesOrders } = makeKernel({ activePrint: true });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({
        applied: false,
        refusal: 'print order on this line — decide on WowPress',
      });
      expect(salesOrders.cancel).not.toHaveBeenCalled();
    });

    it('인쇄 줄 거절이어도 붙잡기는 이미 끝났다', async () => {
      const { k, holdForDecrease } = makeKernel({ activePrint: true });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({
        applied: false,
        refusal: 'print order on this line — decide on WowPress',
      });
      expect(holdForDecrease).toHaveBeenCalledTimes(1);
    });

    it('도메인 거절은 그 문구로 거절한다', async () => {
      const { k } = makeKernel({ cancelError: new BadRequestError('nope') });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({ applied: false, refusal: 'nope' });
    });

    it('그 자리에서 끝나지 않은 취소는 savepoint 를 되돌리고 거절한다', async () => {
      const { k } = makeKernel({ followUp: 'shipment cancellation would wait' });
      const { tx } = makeTx();
      expect(await k.noticeChannelDecrease(decrease, tx as never)).toEqual({
        applied: false,
        refusal: 'shipment cancellation would wait',
      });
      // savepoint 콜백이 던졌다 = 되돌렸다
      await expect(tx.transaction.mock.results[0].value).rejects.toBeDefined();
    });

    it('도메인 거절이 아닌 예외는 그대로 던진다', async () => {
      const boom = new Error('deadlock');
      const { k } = makeKernel({ cancelError: boom });
      const { tx } = makeTx();
      await expect(k.noticeChannelDecrease(decrease, tx as never)).rejects.toBe(boom);
    });
  });
});
