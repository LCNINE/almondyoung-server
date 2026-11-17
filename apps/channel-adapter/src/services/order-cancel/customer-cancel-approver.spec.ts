import { BadRequestException, Logger } from '@nestjs/common';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { CustomerCancelApprover, isApprovalActFor, NAVER_ALREADY_APPROVED_CODE } from './customer-cancel-approver';

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
  const coupang = { stoppedShipment: jest.fn(), getSingleReturnRequest: jest.fn() };
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

  describe('채널별 스위치', () => {
    it('ACT_CHANNELS=coupang 이면 쿠팡만 act', () => {
      const env = { CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS: 'coupang' };
      expect(isApprovalActFor('coupang', env)).toBe(true);
      expect(isApprovalActFor('naver', env)).toBe(false);
    });
    it('쉼표 목록은 공백을 허용한다', () => {
      expect(isApprovalActFor('naver', { CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS: 'coupang, naver' })).toBe(true);
    });
    it('옛 MODE=act 는 두 채널 모두 act', () => {
      expect(isApprovalActFor('naver', { CHANNEL_CANCEL_APPROVAL_MODE: 'act' })).toBe(true);
      expect(isApprovalActFor('coupang', { CHANNEL_CANCEL_APPROVAL_MODE: 'act' })).toBe(true);
    });
    it('아무 값도 없으면 둘 다 관찰', () => {
      expect(isApprovalActFor('naver', {})).toBe(false);
      expect(isApprovalActFor('coupang', {})).toBe(false);
    });
    it('네이버 관찰 + 쿠팡 act 가 한 프로세스에서 갈린다', async () => {
      delete process.env.CHANNEL_CANCEL_APPROVAL_MODE;
      process.env.CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS = 'coupang';
      try {
        const { approver, naver } = setup();
        expect(await approver.approve(base)).toMatchObject({ failureCode: 'approval_observe_mode' });
        expect(naver.approveCancel).not.toHaveBeenCalled();
      } finally {
        delete process.env.CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS;
      }
    });
  });

  const coupangBase: Command = {
    ...base,
    salesChannel: 'coupang',
    scope: 'full',
    answers: { channelRequestRef: '555', needsApproval: true },
  };

  it('쿠팡 act 는 접수 단건 조회의 cancelCountSum 으로 출고중지완료를 부른다', async () => {
    const { approver, coupang } = setup();
    process.env.COUPANG_VENDOR_ID = 'vendor-1';
    coupang.getSingleReturnRequest.mockResolvedValue({ code: 200, data: { receiptId: '555', cancelCountSum: 3 } });
    coupang.stoppedShipment.mockResolvedValue({ data: { resultCode: 'SUCCESS', resultMessage: '' } });
    const result = await approver.approve({ ...coupangBase, lines: [{ channelOrderItemId: 'l1', quantity: 1 }] });
    expect(result).toEqual({ kind: 'approved' });
    expect(coupang.getSingleReturnRequest).toHaveBeenCalledWith('555');
    expect(coupang.stoppedShipment).toHaveBeenCalledWith({ vendorId: 'vendor-1', receiptId: '555', cancelCount: 3 });
  });

  it.each([
    ['cancelCountSum 0', { code: 200, data: { cancelCountSum: 0 } }],
    ['빈 data', { code: 200, data: {} }],
    ['data 없음', { code: 200 }],
    ['code 500', { code: 500, data: { cancelCountSum: 3 } }],
  ])('쿠팡 수량을 모르면(%s) 영구 실패', async (_name, response) => {
    const { approver, coupang } = setup();
    process.env.COUPANG_VENDOR_ID = 'vendor-1';
    coupang.getSingleReturnRequest.mockResolvedValue(response);
    const result = await approver.approve(coupangBase);
    expect(result).toMatchObject({ kind: 'failed', retryable: false, failureCode: 'coupang_cancel_count_unknown' });
    expect(coupang.stoppedShipment).not.toHaveBeenCalled();
  });

  it.each([
    [404, false],
    [400, false],
    [429, true],
    [500, true],
    [undefined, true],
  ])('단건 조회 http %s -> retryable %s', async (status, retryable) => {
    const { approver, coupang } = setup();
    process.env.COUPANG_VENDOR_ID = 'vendor-1';
    coupang.getSingleReturnRequest.mockRejectedValue(Object.assign(new Error('x'), { status }));
    const result = await approver.approve(coupangBase);
    expect(result).toMatchObject({ kind: 'failed', retryable });
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
      coupang.getSingleReturnRequest.mockResolvedValue({ code: 200, data: { cancelCountSum: 1 } });
      coupang.stoppedShipment.mockRejectedValue(withStatus(status));
      expect(await approver.approve(coupangCmd)).toMatchObject({ kind: 'failed', retryable });
    });

    it('coupang zod BadRequestException is permanent', async () => {
      const { approver, coupang } = setup();
      process.env.COUPANG_VENDOR_ID = 'vendor-1';
      coupang.getSingleReturnRequest.mockResolvedValue({ code: 200, data: { cancelCountSum: 1 } });
      coupang.stoppedShipment.mockRejectedValue(new BadRequestException('bad'));
      expect(await approver.approve(coupangCmd)).toMatchObject({ kind: 'failed', retryable: false });
    });

    it('coupang resultCode FAIL is permanent', async () => {
      const { approver, coupang } = setup();
      process.env.COUPANG_VENDOR_ID = 'vendor-1';
      coupang.getSingleReturnRequest.mockResolvedValue({ code: 200, data: { cancelCountSum: 1 } });
      coupang.stoppedShipment.mockResolvedValue({ data: { resultCode: 'FAIL', resultMessage: 'no' } });
      expect(await approver.approve(coupangCmd)).toMatchObject({ kind: 'failed', retryable: false });
    });
  });
});
