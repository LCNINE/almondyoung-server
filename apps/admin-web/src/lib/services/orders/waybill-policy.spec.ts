import {
  isCarrierSupported,
  isWaybillIssued,
  isWaybillPendingIssue,
  isWaybillFailed,
  isWaybillWaitingRetry,
  retryNoticeOf,
  WAYBILL_CARRIERS,
  WAYBILL_LIVE_CARRIERS,
} from './waybill-policy';

describe('waybill-policy', () => {
  it('lists all enum carriers but only HANJIN is live', () => {
    expect(WAYBILL_CARRIERS).toEqual([
      'CJ',
      'HANJIN',
      'LOTTE',
      'LOGEN',
      'KDEXP',
      'CJGLS',
    ]);
    expect(WAYBILL_LIVE_CARRIERS).toEqual(['HANJIN']);
    expect(isCarrierSupported('HANJIN')).toBe(true);
    expect(isCarrierSupported('CJ')).toBe(false);
  });

  it('treats only registered/used as issued', () => {
    expect(isWaybillIssued('registered')).toBe(true);
    expect(isWaybillIssued('used')).toBe(true);
    expect(isWaybillIssued('allocated')).toBe(false);
    expect(isWaybillIssued('pending')).toBe(false);
    expect(isWaybillIssued(null)).toBe(false);
  });

  it('classifies pending and failed states', () => {
    expect(isWaybillPendingIssue('pending')).toBe(true);
    expect(isWaybillPendingIssue('allocated')).toBe(true);
    expect(isWaybillPendingIssue('registered')).toBe(false);
    expect(isWaybillFailed('failed')).toBe(true);
    expect(isWaybillFailed('abandoned')).toBe(true);
    expect(isWaybillFailed('pending')).toBe(false);
  });
});

describe('isWaybillWaitingRetry / retryNoticeOf (#914)', () => {
  const NOW = new Date('2026-09-21T05:00:00Z');
  const FUTURE = '2026-09-21T15:00:00Z';
  const PAST = '2026-09-21T01:00:00Z';

  it('미래 nextAttemptAt 을 가진 pending 만 «대기»다', () => {
    expect(isWaybillWaitingRetry('pending', FUTURE, NOW)).toBe(true);
    expect(isWaybillWaitingRetry('pending', PAST, NOW)).toBe(false);
    expect(isWaybillWaitingRetry('pending', null, NOW)).toBe(false);
  });

  // 시간예산 초과로 «미착수» 된 건도 pending 인데, 그쪽은 nextAttemptAt 이 없어 대기로 세지 않는다.
  it('pending 이 아닌 상태는 nextAttemptAt 이 있어도 대기가 아니다', () => {
    expect(isWaybillWaitingRetry('allocated', FUTURE, NOW)).toBe(false);
    expect(isWaybillWaitingRetry('failed', FUTURE, NOW)).toBe(false);
  });

  it('깨진 날짜 문자열에 속지 않는다', () => {
    expect(isWaybillWaitingRetry('pending', 'not-a-date', NOW)).toBe(false);
  });

  it('대기 중일 때만 안내 문구를 만든다 (KST 로 읽는다)', () => {
    expect(retryNoticeOf('pending', PAST, NOW)).toBeNull();
    const notice = retryNoticeOf('pending', FUTURE, NOW);
    expect(notice).toContain('일시적 거절');
    expect(notice).toContain('9. 22.'); // 2026-09-21T15:00Z = KST 09-22 00:00
  });
});
