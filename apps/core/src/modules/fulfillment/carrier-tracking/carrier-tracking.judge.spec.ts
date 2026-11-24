import type { CarrierScan } from '../waybill/carrier/carrier-gateway.interface';
import {
  confirmationResumeAt,
  judgeTracking,
  scanKeyOf,
  summarizeScans,
  type TrackingCheckFacts,
  type TrackingConfirmationFacts,
  type TrackingFacts,
} from './carrier-tracking.judge';

// 2026-11-20 은 금요일이다
const FRIDAY = new Date('2026-11-20T06:00:00.000Z');
const check = (over: Partial<TrackingCheckFacts> = {}): TrackingCheckFacts => ({
  attemptedAt: FRIDAY,
  outcome: 'no_scan',
  errorCode: null,
  answeredAt: FRIDAY,
  scanCode: null,
  scanStatus: null,
  scanAt: null,
  scanLocation: null,
  scanReason: null,
  acceptedScanAt: null,
  ...over,
});
const facts = (over: Partial<TrackingFacts> = {}): TrackingFacts => ({
  attemptStatus: 'dispatched',
  shipmentStatus: 'shipped',
  dispatchedAt: FRIDAY,
  carrierAcceptedAt: null,
  check: check(),
  confirmation: null,
  ...over,
});
const confirmation = (over: Partial<TrackingConfirmationFacts> = {}): TrackingConfirmationFacts => ({
  id: 'c1',
  kind: 'no_scan',
  scanKey: '',
  outcome: 'wait',
  resumeAt: new Date('2026-11-24T06:00:00.000Z'),
  note: '한진에 확인',
  actorId: 'actor',
  createdAt: FRIDAY,
  ...over,
});
const answeredAt = (now: Date) => check({ answeredAt: new Date(now.getTime() - 60_000) });

describe('judgeTracking', () => {
  it('집하 스캔이 없어도 다음 영업일 같은 시각 전이면 정상이다(주말은 세지 않는다)', () => {
    const before = new Date('2026-11-23T05:59:59.000Z');
    const at = new Date('2026-11-23T06:00:00.000Z');
    expect(judgeTracking(facts({ check: answeredAt(before) }), before)).toMatchObject({ kind: null, raised: false });
    expect(judgeTracking(facts({ check: answeredAt(at) }), at)).toMatchObject({ kind: 'no_scan', raised: true });
  });

  it('기준이 지났는데 세 시간 넘게 답을 못 받았거나 한 번도 못 물었으면 «스캔 없음»이라 하지 않는다', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    const stale = check({ answeredAt: new Date('2026-11-23T08:59:59.000Z') });
    const fresh = check({ answeredAt: new Date('2026-11-23T09:00:00.000Z') });
    expect(judgeTracking(facts({ check: stale }), now).kind).toBe('unverified');
    expect(judgeTracking(facts({ check: null }), now).kind).toBe('unverified');
    expect(judgeTracking(facts({ check: fresh }), now).kind).toBe('no_scan');
  });

  it('집하출발만 있으면 아직 받은 것이 아니다', () => {
    const now = new Date('2026-11-23T07:00:00.000Z');
    const departed = { ...answeredAt(now), scanCode: '07', scanStatus: 'pending', scanAt: FRIDAY };
    expect(judgeTracking(facts({ check: departed }), now)).toMatchObject({ kind: 'no_scan', accepted: false });
  });

  it.each([
    ['canceled', 'canceled'],
    ['pickup_missed', 'pickup_missed'],
    ['failed', 'undeliverable'],
    ['delivered', 'not_applied'],
  ])('마지막 스캔이 %s 면 기준 시각과 무관하게 바로 확인할 일이다', (scanStatus, kind) => {
    const now = new Date(FRIDAY.getTime() + 60_000);
    const row = check({ outcome: 'scans', scanCode: 'xx', scanStatus, scanAt: FRIDAY });
    expect(judgeTracking(facts({ check: row }), now)).toMatchObject({ kind, raised: true });
  });

  it('번호가 틀렸다는 답은 바로 확인할 일이다', () => {
    const row = check({ outcome: 'rejected', errorCode: 'ERROR-02' });
    expect(judgeTracking(facts({ check: row }), new Date(FRIDAY.getTime() + 1))).toMatchObject({
      kind: 'invalid_waybill',
      scanKey: 'rejected:ERROR-02',
    });
  });

  it('택배사가 받았으면 확인할 일이 아니고, 14일이 지나면 조회가 끝났다고 알린다', () => {
    const accepted = { carrierAcceptedAt: FRIDAY, shipmentStatus: 'in_transit' };
    const moving = check({ outcome: 'scans', scanCode: '31', scanStatus: 'in_transit', scanAt: FRIDAY });
    expect(judgeTracking(facts({ ...accepted, check: moving }), new Date('2026-12-04T06:00:00.000Z')).kind).toBeNull();
    expect(judgeTracking(facts({ ...accepted, check: moving }), new Date('2026-12-04T06:00:00.001Z')).kind).toBe(
      'poll_ended',
    );
  });

  it('되돌린 송장은 택배사가 가져갔을 때만 확인할 일이다', () => {
    const recalled = { attemptStatus: 'recalled', shipmentStatus: 'draft' };
    expect(judgeTracking(facts(recalled), new Date('2026-12-30T00:00:00Z')).kind).toBeNull();
    expect(judgeTracking(facts({ ...recalled, check: check({ acceptedScanAt: FRIDAY }) }), FRIDAY).kind).toBe(
      'recalled_but_moving',
    );
  });

  it('되돌리는 중이거나 배송이 끝난 출고는 보지 않는다', () => {
    const late = new Date('2026-12-30T00:00:00Z');
    expect(judgeTracking(facts({ attemptStatus: 'recovery_required' }), late).kind).toBeNull();
    expect(judgeTracking(facts({ shipmentStatus: 'delivered' }), late).kind).toBeNull();
  });

  describe('확인 기록', () => {
    const now = new Date('2026-11-23T07:00:00.000Z');
    const overdue = { check: answeredAt(now) };

    it('기다림은 다음 확인 시각까지만 내린다', () => {
      expect(judgeTracking(facts({ ...overdue, confirmation: confirmation() }), now)).toMatchObject({
        kind: 'no_scan',
        raised: false,
      });
      const resume = new Date('2026-11-24T06:00:00.000Z');
      expect(judgeTracking(facts({ check: answeredAt(resume), confirmation: confirmation() }), resume).raised).toBe(
        true,
      );
    });

    it('조회가 되다 말아도 «집하 스캔 없음» 확인은 풀리지 않는다', () => {
      const unverified = facts({ check: null, confirmation: confirmation() });
      expect(judgeTracking(unverified, now)).toMatchObject({ kind: 'unverified', raised: false });
    });

    it('새 스캔이 오면 앞선 확인은 지난 일이다 — 끝남이어도', () => {
      const missed = check({ outcome: 'scans', scanCode: '08', scanStatus: 'pickup_missed', scanAt: now });
      for (const outcome of ['wait', 'closed'] as const) {
        const row = facts({ check: missed, confirmation: confirmation({ outcome }) });
        expect(judgeTracking(row, now)).toMatchObject({ kind: 'pickup_missed', raised: true });
      }
    });

    it('같은 스캔이어도 기다림은 이유가 바뀌면 다시 뜨고, 끝남은 그대로 내려 둔다', () => {
      const later = new Date('2026-12-30T00:00:00Z');
      const wait = confirmation({ resumeAt: new Date('2027-01-01T00:00:00Z') });
      expect(judgeTracking(facts({ confirmation: wait }), later)).toMatchObject({ kind: 'poll_ended', raised: true });
      const closed = confirmation({ outcome: 'closed', resumeAt: null });
      expect(judgeTracking(facts({ confirmation: closed }), later)).toMatchObject({
        kind: 'poll_ended',
        raised: false,
      });
    });

    it('금요일에 기다리기로 하면 월요일 같은 시각에 다시 뜬다', () => {
      expect(confirmationResumeAt(FRIDAY)).toEqual(new Date('2026-11-23T06:00:00.000Z'));
    });
  });
});

describe('summarizeScans', () => {
  const scan = (statusCode: string, status: CarrierScan['status'], iso: string): CarrierScan => ({
    statusCode,
    status,
    occurredAt: new Date(iso),
  });

  it('가장 최근 스캔과 처음 받은 시각을 고른다. 모르는 코드와 읽을 수 없는 시각은 세지 않는다', () => {
    const summary = summarizeScans([
      scan('31', 'in_transit', '2026-11-21T01:00:00Z'),
      scan('11', 'in_transit', '2026-11-20T09:00:00Z'),
      scan('07', 'pending', '2026-11-20T08:00:00Z'),
      scan('77', 'unknown', '2026-11-22T01:00:00Z'),
      scan('92', 'failed', 'not-a-date'),
    ]);
    expect(summary.latest?.statusCode).toBe('31');
    expect(summary.acceptedScanAt).toEqual(new Date('2026-11-20T09:00:00Z'));
  });

  it('집하출발·미집하만 있으면 받은 것이 아니다', () => {
    const summary = summarizeScans([
      scan('07', 'pending', '2026-11-20T08:00:00Z'),
      scan('08', 'pickup_missed', '2026-11-20T09:00:00Z'),
    ]);
    expect(summary).toMatchObject({ acceptedScanAt: null, latest: { statusCode: '08' } });
  });

  it('스캔 열쇠는 코드와 시각이다', () => {
    expect(scanKeyOf(null)).toBe('');
    expect(scanKeyOf(check())).toBe('');
    expect(scanKeyOf(check({ scanCode: '08', scanAt: FRIDAY }))).toBe('08@2026-11-20T06:00:00.000Z');
  });
});
