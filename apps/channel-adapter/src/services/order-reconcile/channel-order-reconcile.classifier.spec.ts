import type { LifecycleObservation } from '../order-collection/channel-order-source.interface';
import { ClassifyInput, classifyChannelOrder } from './channel-order-reconcile.classifier';

const NOW = new Date('2026-10-16T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const cancelled: LifecycleObservation[] = [
  {
    eventType: 'OrderCancelled',
    eventKey: 'cancelled',
    rawEvent: {},
    payload: {
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      reason: 'ADMIN_CANCEL',
      reasonDetail: 'x',
      cancelledBy: 'medusa',
      cancelledAt: '2026-10-16T09:00:00Z',
      refundRequired: false,
    },
  },
];

const base = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  snapshot: {
    externalOrderId: 'order_1',
    paymentState: 'accepted',
    sourceUpdatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    createdAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
    lifecycle: [],
  },
  wmsOrderId: null,
  openQuarantine: false,
  adapterOutboxFailed: false,
  core: { salesOrderStatus: null, openEventFailure: false },
  attemptCountFor: () => 0,
  pollWatermark: new Date(NOW.getTime() - 60_000),
  now: NOW,
  ...over,
});
const withSnapshot = (over: Partial<ClassifyInput['snapshot']>, rest: Partial<ClassifyInput> = {}) =>
  base({ ...rest, snapshot: { ...base().snapshot, ...over } });

describe('classifyChannelOrder', () => {
  it('결제 accepted 인데 SO 가 없으면 missing_order · auto', () => {
    expect(classifyChannelOrder(base())).toEqual({
      kind: 'missing_order',
      handling: 'auto',
      humanReason: null,
      coreStatus: null,
    });
  });

  it('결제 accepted 이고 SO 가 있으면 정상', () => {
    expect(classifyChannelOrder(base({ core: { salesOrderStatus: 'confirmed', openEventFailure: false } }))).toBeNull();
  });

  it('pending(무통장 입금 대기·환불 신청)은 원래 core 에 없다', () => {
    expect(classifyChannelOrder(withSnapshot({ paymentState: 'pending' }))).toBeNull();
  });

  it('수집 전에 취소된 주문(매핑 없음)은 정상', () => {
    expect(classifyChannelOrder(withSnapshot({ paymentState: 'terminal', lifecycle: cancelled }))).toBeNull();
  });

  it('취소 · 매핑 있음 · SO 없음 → missing_order', () => {
    expect(
      classifyChannelOrder(withSnapshot({ paymentState: 'terminal', lifecycle: cancelled }, { wmsOrderId: 'w1' })),
    ).toMatchObject({ kind: 'missing_order', handling: 'auto' });
  });

  it('취소 · SO cancelled → 정상', () => {
    expect(
      classifyChannelOrder(
        withSnapshot(
          { paymentState: 'terminal', lifecycle: cancelled },
          { wmsOrderId: 'w1', core: { salesOrderStatus: 'cancelled', openEventFailure: false } },
        ),
      ),
    ).toBeNull();
  });

  it('취소 · SO confirmed → cancel_not_applied · auto (나이 무관, D6)', () => {
    const old = new Date(NOW.getTime() - 30 * 24 * HOUR).toISOString();
    expect(
      classifyChannelOrder(
        withSnapshot(
          { paymentState: 'terminal', lifecycle: cancelled, createdAt: old },
          { wmsOrderId: 'w1', core: { salesOrderStatus: 'confirmed', openEventFailure: false } },
        ),
      ),
    ).toEqual({ kind: 'cancel_not_applied', handling: 'auto', humanReason: null, coreStatus: 'confirmed' });
  });

  it('취소 · SO shipped(셀메이트) → human / core_status', () => {
    expect(
      classifyChannelOrder(
        withSnapshot(
          { paymentState: 'terminal', lifecycle: cancelled },
          { wmsOrderId: 'w1', core: { salesOrderStatus: 'shipped', openEventFailure: false } },
        ),
      ),
    ).toMatchObject({ kind: 'cancel_not_applied', handling: 'human', humanReason: 'core_status' });
  });

  it('생성 3일 밖의 missing_order 는 human / out_of_window (D5)', () => {
    const created = new Date(NOW.getTime() - 3 * 24 * HOUR - 60_000).toISOString();
    expect(classifyChannelOrder(withSnapshot({ createdAt: created }))).toMatchObject({
      handling: 'human',
      humanReason: 'out_of_window',
    });
  });

  it('생성 3일 경계 안쪽은 auto', () => {
    const created = new Date(NOW.getTime() - 3 * 24 * HOUR + 60_000).toISOString();
    expect(classifyChannelOrder(withSnapshot({ createdAt: created }))).toMatchObject({ handling: 'auto' });
  });

  it('열린 수집 격리가 있으면 대사하지 않는다', () => {
    expect(classifyChannelOrder(base({ openQuarantine: true }))).toBeNull();
  });

  it('갱신 30분이 안 된 주문은 건너뛴다', () => {
    expect(
      classifyChannelOrder(withSnapshot({ sourceUpdatedAt: new Date(NOW.getTime() - 29 * 60_000).toISOString() })),
    ).toBeNull();
  });

  it('폴러 워터마크 − 2분 뒤에 갱신된 주문은 건너뛴다 (폴러 정체)', () => {
    const watermark = new Date(NOW.getTime() - 5 * HOUR);
    expect(classifyChannelOrder(base({ pollWatermark: watermark }))).toBeNull();
  });

  it('워터마크가 없으면(폴러가 한 번도 안 돎) 판정하지 않는다', () => {
    expect(classifyChannelOrder(base({ pollWatermark: null }))).toBeNull();
  });

  it('어댑터 outbox FAILED 나 core 이벤트 실패가 열려 있으면 human / event_failure_open (D8)', () => {
    expect(classifyChannelOrder(base({ wmsOrderId: 'w1', adapterOutboxFailed: true }))).toMatchObject({
      handling: 'human',
      humanReason: 'event_failure_open',
    });
    expect(
      classifyChannelOrder(base({ wmsOrderId: 'w1', core: { salesOrderStatus: null, openEventFailure: true } })),
    ).toMatchObject({ handling: 'human', humanReason: 'event_failure_open' });
  });

  it('시도 3회에 닿으면 human / attempts_exhausted', () => {
    expect(classifyChannelOrder(base({ attemptCountFor: () => 3 }))).toMatchObject({
      handling: 'human',
      humanReason: 'attempts_exhausted',
    });
  });

  it('시도 수는 판정된 종류의 것만 본다', () => {
    // missing_order 로 3번 시도했던 주문이 이제 cancel_not_applied 로 판정되면 새로 센다
    const input = withSnapshot(
      { paymentState: 'terminal', lifecycle: cancelled },
      {
        wmsOrderId: 'w1',
        core: { salesOrderStatus: 'confirmed', openEventFailure: false },
        attemptCountFor: (kind) => (kind === 'missing_order' ? 3 : 0),
      },
    );
    expect(classifyChannelOrder(input)).toMatchObject({ kind: 'cancel_not_applied', handling: 'auto' });
  });
});
