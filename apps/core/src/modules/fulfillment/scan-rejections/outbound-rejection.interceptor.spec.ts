import { CallHandler, ConflictException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, firstValueFrom, of, throwError } from 'rxjs';
import { OutboundRejectionInterceptor, RecordsOutboundRejection } from './outbound-rejection.interceptor';
import { OutboundScanRejectionManager } from './outbound-scan-rejection.manager';

class Routes {
  @RecordsOutboundRejection('shipment.simple_outbound.scan')
  scan() {}
  plain() {}
}

const SHIPMENT = '0a000000-0000-4000-8000-000000000001';

function contextFor(handler: () => void, request: object): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const request = {
  params: { shipmentId: SHIPMENT },
  headers: { 'idempotency-key': ' key-1 ' },
  body: { barcode: ' 8800 ', quantity: 2 },
  user: { userId: 'worker-1' },
};

describe('출고 저장 거절 기록 인터셉터', () => {
  let record: jest.Mock;
  let interceptor: OutboundRejectionInterceptor;
  beforeEach(() => {
    record = jest.fn().mockResolvedValue(true);
    interceptor = new OutboundRejectionInterceptor(new Reflector(), {
      record,
    } as unknown as OutboundScanRejectionManager);
  });

  const run = (handler: () => void, next: CallHandler, req: object = request) =>
    firstValueFrom(interceptor.intercept(contextFor(handler, req), next));

  it('성공 응답은 그대로 두고 기록하지 않는다', async () => {
    await expect(run(Routes.prototype.scan, { handle: () => of({ ok: true }) })).resolves.toEqual({ ok: true });
    expect(record).not.toHaveBeenCalled();
  });

  it('관리자 손이 필요한 거절은 남기고, 같은 예외에 «남김» 표시를 붙여 다시 던진다', async () => {
    const error = new ConflictException({ code: 'SHIPMENT_TOTE_NOT_RELEASED', message: 'x' });

    await expect(run(Routes.prototype.scan, { handle: () => throwError(() => error) })).rejects.toBe(error);

    expect(record).toHaveBeenCalledWith({
      commandType: 'shipment.simple_outbound.scan',
      shipmentId: SHIPMENT,
      idempotencyKey: 'key-1',
      actorId: 'worker-1',
      barcode: '8800',
      quantity: 2,
      rejection: { code: 'SHIPMENT_TOTE_NOT_RELEASED', reasonCode: null },
      rejectedAt: expect.any(Date),
    });
    expect(error.getResponse()).toMatchObject({ rejectionRecorded: true });
  });

  it('기록 시각은 거절을 남긴 때가 아니라 그 요청이 시작된 때다', async () => {
    const error = new ConflictException({ code: 'SHIPMENT_TOTE_NOT_RELEASED', message: 'x' });
    const before = Date.now();
    let handledAt = 0;
    const slow: CallHandler = {
      handle: () =>
        defer(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          handledAt = Date.now();
          throw error;
        }),
    };

    await expect(run(Routes.prototype.scan, slow)).rejects.toBe(error);

    const [[input]] = record.mock.calls as [[{ rejectedAt: Date }]];
    expect(input.rejectedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(input.rejectedAt.getTime()).toBeLessThan(handledAt);
  });

  it('남기지 못하면 표시 없이 원래 거절만 던진다', async () => {
    record.mockResolvedValue(false);
    const error = new ConflictException({ code: 'SHIPMENT_TOTE_NOT_RELEASED', message: 'x' });

    await expect(run(Routes.prototype.scan, { handle: () => throwError(() => error) })).rejects.toBe(error);

    expect(error.getResponse()).not.toHaveProperty('rejectionRecorded');
  });

  it('작업자가 풀 거절·표시 없는 라우트·작업자 없는 요청은 기록하지 않는다', async () => {
    const workerError = new ConflictException({ code: 'SIMPLE_OUTBOUND_OVERSCAN', message: 'x' });
    await expect(run(Routes.prototype.scan, { handle: () => throwError(() => workerError) })).rejects.toBe(workerError);
    const adminError = new ConflictException({ code: 'SHIPMENT_TOTE_NOT_RELEASED', message: 'x' });
    await expect(run(Routes.prototype.plain, { handle: () => throwError(() => adminError) })).rejects.toBe(adminError);
    await expect(
      run(Routes.prototype.scan, { handle: () => throwError(() => adminError) }, { ...request, user: undefined }),
    ).rejects.toBe(adminError);

    expect(record).not.toHaveBeenCalled();
  });
});
