import type { CarrierTrackingItem } from '@/lib/api/domains/orders/carrier-tracking.client';
import {
  attentionText,
  groupByKind,
  confirmationText,
  lastCheckText,
  nextStepText,
  normalText,
  pollingText,
  recheckResult,
} from './carrier-tracking-copy';

const NOW = new Date('2026-11-24T06:00:00.000Z');
const item = (
  over: Partial<CarrierTrackingItem> = {}
): CarrierTrackingItem => ({
  dispatchAttemptId: 'a1',
  attemptNo: 1,
  shipmentId: 's1',
  carrier: 'HANJIN',
  trackingNo: '510000000001',
  orders: [],
  kind: 'no_scan',
  raised: true,
  accepted: false,
  recalled: false,
  dispatchedAt: '2026-11-22T06:00:00.000Z',
  dueAt: '2026-11-23T06:00:00.000Z',
  attemptedAt: '2026-11-24T05:50:00.000Z',
  answeredAt: '2026-11-24T05:50:00.000Z',
  lastOutcome: 'no_scan',
  scan: null,
  scanKey: '',
  confirmations: [],
  ...over,
});
const scan = (code: string, status: string, over = {}) => ({
  code,
  status,
  at: '2026-11-24T04:00:00.000Z',
  location: null,
  reason: null,
  ...over,
});

describe('택배사 확인 문구', () => {
  it('집하 기록이 없는 것과 묻지 못한 것을 다르게 말한다', () => {
    expect(attentionText(item(), NOW)).toBe(
      '출고한 지 2일 · 택배사 집하 기록이 없어요'
    );
    const unasked = item({
      kind: 'unverified',
      lastOutcome: 'unknown',
      answeredAt: '2026-11-24T00:00:00.000Z',
    });
    expect(attentionText(unasked, NOW)).toContain('물어보지 못했어요');
    expect(lastCheckText(unasked, NOW)).toBe(
      '택배사가 답하지 않음 · 마지막 답 6시간 전'
    );
    expect(
      lastCheckText(item({ attemptedAt: null, lastOutcome: null }), NOW)
    ).toBe('아직 택배사에 묻지 않았어요');
    expect(
      lastCheckText(item({ lastOutcome: 'unknown', answeredAt: null }), NOW)
    ).toBe('택배사가 아직 한 번도 답하지 않았어요');
  });

  it('미집하·취소·배송불가는 택배사가 준 이유를 붙인다', () => {
    const missed = item({
      kind: 'pickup_missed',
      scan: scan('08', 'pickup_missed', { reason: '화물미준비' }),
    });
    expect(attentionText(missed, NOW)).toBe(
      '기사가 가져가지 못했어요(미집하) · 화물미준비'
    );
    expect(lastCheckText(missed, NOW)).toBe(
      '최근 스캔 미집하 · 2시간 전 · 10분 전 확인'
    );
  });

  it('한진 코드는 이름으로, 모르는 코드는 상태로 보인다', () => {
    expect(lastCheckText(item({ scan: scan('07', 'pending') }), NOW)).toContain(
      '최근 스캔 집하출발'
    );
    expect(
      lastCheckText(item({ carrier: 'CJ', scan: scan('07', 'pending') }), NOW)
    ).toContain('최근 스캔 집하 전');
  });

  it('되돌릴 수 없는 사람에게는 넘길 사람을 말한다', () => {
    expect(nextStepText('no_scan', true)).toContain('출고를 되돌린 뒤');
    expect(nextStepText('no_scan', false)).toContain('물류 관리자에게');
    expect(nextStepText('no_scan', false)).not.toContain('출고를 되돌린 뒤');
  });

  it('확인할 일이 아니면 언제부터 확인할 송장이 되는지 말한다', () => {
    const waiting = item({ kind: null, dueAt: '2026-11-25T06:00:00.000Z' });
    expect(normalText(waiting, NOW)).toContain('집하를 기다리는 중');
    expect(normalText(waiting, NOW)).toContain('11월 25일');
    expect(normalText(item({ kind: null, accepted: true }), NOW)).toBe(
      '택배사가 받았어요.'
    );
    expect(normalText(item({ kind: null, recalled: true }), NOW)).toContain(
      '되돌린 출고'
    );
  });

  it('확인 기록은 누가 언제까지 기다리는지, 끝냈는지 보인다', () => {
    const row = {
      id: 'c',
      kind: 'no_scan',
      outcome: 'wait' as const,
      resumeAt: '2026-11-25T06:00:00.000Z',
      note: '부천 지점 통화',
      actorId: 'u',
      createdAt: '2026-11-24T06:00:00.000Z',
    };
    expect(confirmationText(row, '김관리')).toMatch(
      /김관리 · .*까지 기다림 · 부천 지점 통화/
    );
    expect(
      confirmationText({ ...row, outcome: 'closed', resumeAt: null }, '')
    ).toContain('담당자 · 끝남 · 부천 지점 통화');
  });

  it('자동 조회가 안 되면 마지막으로 답한 때를 말한다', () => {
    expect(pollingText({ failing: false, lastAnsweredAt: null }, NOW)).toBe('');
    expect(
      pollingText(
        { failing: true, lastAnsweredAt: '2026-11-24T00:00:00.000Z' },
        NOW
      )
    ).toContain('마지막 답 6시간 전');
    expect(pollingText({ failing: true, lastAnsweredAt: null }, NOW)).toContain(
      '한 번도 답하지 않았어요'
    );
  });

  it('같은 이유끼리 묶고 받은 순서를 지킨다', () => {
    const rows = [
      item({ dispatchAttemptId: 'm', kind: 'pickup_missed' }),
      item({ dispatchAttemptId: 'n1' }),
      item({ dispatchAttemptId: 'x', kind: null }),
      item({ dispatchAttemptId: 'n2' }),
    ];
    expect(
      groupByKind(rows).map((group) => [
        group.kind,
        group.items.map((row) => row.dispatchAttemptId),
      ])
    ).toEqual([
      ['pickup_missed', ['m']],
      ['no_scan', ['n1', 'n2']],
    ]);
  });

  it('다시 조회 결과를 답 없음·풀림·바뀜·그대로로 가른다', () => {
    const before = item();
    expect(recheckResult(before, undefined, NOW).tone).toBe('error');
    expect(
      recheckResult(before, item({ lastOutcome: 'unknown' }), NOW).tone
    ).toBe('error');
    expect(recheckResult(before, item({ kind: null }), NOW).text).toBe(
      '다시 물었어요. 확인할 것이 없어졌어요.'
    );
    expect(recheckResult(before, item(), NOW).text).toBe(
      '다시 물었지만 그대로예요.'
    );
    const missed = item({
      kind: 'pickup_missed',
      scanKey: '08@x',
      scan: scan('08', 'pickup_missed'),
    });
    expect(recheckResult(before, missed, NOW).text).toContain('미집하');
    expect(recheckResult(item({ kind: null }), missed, NOW).text).toContain(
      '미집하'
    );
    expect(
      recheckResult(missed, { ...missed, scanKey: '08@y' }, NOW).text
    ).toContain('미집하');
    expect(
      recheckResult(item({ kind: null }), item({ kind: null }), NOW).text
    ).toContain('아직 없어요');
  });
});
