import { BadRequestException, Logger } from '@nestjs/common';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { CustomerCancelApprover, NAVER_ALREADY_APPROVED_CODE } from './customer-cancel-approver';

type Command = CancelChannelOrderPayload & { answers: NonNullable<CancelChannelOrderPayload['answers']> };

const base: Command = {
  requestId: 'req-1',
  salesChannel: 'naver',
  externalOrderId: 'ord-1',
  scope: 'full',
  requestedBy: 'channel-customer',
  requestedAt: '2026-11-10T00:00:00.000Z',
  answers: { channelRequestRef: 'po-1', needsApproval: true },
};

function setup() {
  const naver = { approveCancel: jest.fn() };
  const coupang = { stoppedShipment: jest.fn() };
  const approver = new CustomerCancelApprover(naver as never, coupang as never);
  return { approver, naver, coupang };
}

const ok = { timestamp: 't', traceId: 'x', data: { successProductOrderIds: ['po-1'], failProductOrderInfos: [] } };
const axiosError = (status?: number) =>
  Object.assign(new Error('boom'), { isAxiosError: true, response: status ? { status } : undefined });

describe('CustomerCancelApprover', () => {
  const prev = process.env.CHANNEL_CANCEL_APPROVAL_MODE;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.env.CHANNEL_CANCEL_APPROVAL_MODE = 'act';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (prev === undefined) delete process.env.CHANNEL_CANCEL_APPROVAL_MODE;
    else process.env.CHANNEL_CANCEL_APPROVAL_MODE = prev;
  });

  it('observe mode reports approval_observe_mode without calling the market', async () => {
    delete process.env.CHANNEL_CANCEL_APPROVAL_MODE;
    const { approver, naver, coupang } = setup();
    const result = await approver.approve(base);
    expect(result).toEqual({
      kind: 'failed',
      retryable: false,
      failureCode: 'approval_observe_mode',
      message: '관찰 모드 — 판매자센터에서 취소를 승인하세요.',
    });
    expect(naver.approveCancel).not.toHaveBeenCalled();
    expect(coupang.stoppedShipment).not.toHaveBeenCalled();
  });

  it('act mode calls naver approveCancel with the request ref', async () => {
    const { approver, naver } = setup();
    naver.approveCancel.mockResolvedValue(ok);
    expect(await approver.approve(base)).toEqual({ kind: 'approved' });
    expect(naver.approveCancel).toHaveBeenCalledWith('po-1');
  });

  it('naver already-approved response counts as success', async () => {
    const { approver, naver } = setup();
    naver.approveCancel.mockResolvedValue({
      ...ok,
      data: {
        successProductOrderIds: [],
        failProductOrderInfos: [{ productOrderId: 'po-1', code: NAVER_ALREADY_APPROVED_CODE, message: 'm' }],
      },
    });
    expect(await approver.approve(base)).toEqual({ kind: 'approved' });
  });

  it('naver failure item with another code is a permanent failure', async () => {
    const { approver, naver } = setup();
    naver.approveCancel.mockResolvedValue({
      ...ok,
      data: {
        successProductOrderIds: [],
        failProductOrderInfos: [{ productOrderId: 'po-1', code: 'X', message: 'no' }],
      },
    });
    expect(await approver.approve(base)).toMatchObject({ kind: 'failed', retryable: false, failureCode: 'X' });
  });

  it('needsApproval false succeeds without calling the market', async () => {
    const { approver, naver } = setup();
    const result = await approver.approve({ ...base, answers: { channelRequestRef: 'po-1', needsApproval: false } });
    expect(result).toEqual({ kind: 'approved' });
    expect(naver.approveCancel).not.toHaveBeenCalled();
  });

  it('channel without approval capability is channel_not_supported', async () => {
    const { approver } = setup();
    expect(await approver.approve({ ...base, salesChannel: 'medusa' })).toMatchObject({
      kind: 'failed',
      retryable: false,
      failureCode: 'channel_not_supported',
    });
  });

  it.each([
    [500, true],
    [429, true],
    [undefined, true],
    [400, false],
    [404, false],
  ])('naver http %s -> retryable %s', async (status, retryable) => {
    const { approver, naver } = setup();
    naver.approveCancel.mockRejectedValue(axiosError(status));
    expect(await approver.approve(base)).toMatchObject({ kind: 'failed', retryable });
  });

  it('coupang act mode calls stoppedShipment with the receipt id', async () => {
    const { approver, coupang } = setup();
    process.env.COUPANG_VENDOR_ID = 'vendor-1';
    coupang.stoppedShipment.mockResolvedValue({ data: { resultCode: 'SUCCESS', resultMessage: '' } });
    const result = await approver.approve({
      ...base,
      salesChannel: 'coupang',
      scope: 'partial',
      lines: [{ channelOrderItemId: 'l1', quantity: 2 }],
      answers: { channelRequestRef: '12345', needsApproval: true },
    });
    expect(result).toEqual({ kind: 'approved' });
    expect(coupang.stoppedShipment).toHaveBeenCalledWith({ vendorId: 'vendor-1', receiptId: 12345, cancelCount: 2 });
  });

  it('coupang without a known cancel count fails permanently', async () => {
    const { approver, coupang } = setup();
    const result = await approver.approve({
      ...base,
      salesChannel: 'coupang',
      answers: { channelRequestRef: '12345', needsApproval: true },
    });
    expect(result).toMatchObject({ kind: 'failed', retryable: false, failureCode: 'coupang_cancel_count_unknown' });
    expect(coupang.stoppedShipment).not.toHaveBeenCalled();
  });

  describe('coupang error classification', () => {
    const lines = [{ channelOrderItemId: 'l1', quantity: 1 }];
    const coupangCmd: Command = {
      ...base,
      salesChannel: 'coupang',
      scope: 'partial',
      lines,
      answers: { channelRequestRef: '12345', needsApproval: true },
    };
    const withStatus = (status?: number) => Object.assign(new Error('쿠팡 실패'), { status });

    it.each([
      [500, true],
      [429, true],
      [undefined, true],
      [400, false],
      [404, false],
    ])('coupang http %s -> retryable %s', async (status, retryable) => {
      const { approver, coupang } = setup();
      process.env.COUPANG_VENDOR_ID = 'vendor-1';
      coupang.stoppedShipment.mockRejectedValue(withStatus(status));
      expect(await approver.approve(coupangCmd)).toMatchObject({ kind: 'failed', retryable });
    });

    it('coupang zod BadRequestException is permanent', async () => {
      const { approver, coupang } = setup();
      process.env.COUPANG_VENDOR_ID = 'vendor-1';
      coupang.stoppedShipment.mockRejectedValue(new BadRequestException('bad'));
      expect(await approver.approve(coupangCmd)).toMatchObject({ kind: 'failed', retryable: false });
    });

    it('coupang resultCode FAIL is permanent', async () => {
      const { approver, coupang } = setup();
      process.env.COUPANG_VENDOR_ID = 'vendor-1';
      coupang.stoppedShipment.mockResolvedValue({ data: { resultCode: 'FAIL', resultMessage: 'no' } });
      expect(await approver.approve(coupangCmd)).toMatchObject({ kind: 'failed', retryable: false });
    });
  });
});
