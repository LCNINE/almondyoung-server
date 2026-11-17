import { waybillFailureText } from './waybill-failure-text';

describe('waybillFailureText', () => {
  it.each([
    ['failed', 'allocate ERROR-01', '운송사가 송장 번호를 주지 않았어요 (ERROR-01) — 상자 화면에서 확인해요'],
    [
      'failed',
      'allocate request_conflict',
      '운송사가 송장 번호를 주지 않았어요 (request_conflict) — 상자 화면에서 확인해요',
    ],
    ['failed', 'register http_400', '운송사가 송장 접수를 거절했어요 (http_400) — 상자 화면에서 확인해요'],
    [
      'failed',
      'register rejected: 주소 확인 필요',
      '운송사가 송장 접수를 거절했어요 (주소 확인 필요) — 상자 화면에서 확인해요',
    ],
    ['failed', 'register rejected: ', '운송사가 송장 접수를 거절했어요 — 상자 화면에서 확인해요'],
    [
      'failed',
      'allocate ERROR-05: WAYBILL_TRANSIENT_CAP_EXCEEDED (3)',
      '운송사가 여러 번 받지 않았어요 (ERROR-05) — 상자 화면에서 다시 발급해요',
    ],
    ['failed', 'WAYBILL_CARRIER_NOT_CONFIGURED: HANJIN', '운송사 연결이 설정되지 않았어요 (HANJIN)'],
    ['abandoned', 'abandoned by operator: 주소 변경', '송장 발급을 중단했어요 — 상자 화면에서 다시 발급해요'],
  ])('%s %s', (status, lastError, expected) => {
    expect(waybillFailureText({ status, lastError })).toBe(expected);
  });

  it('일시적 거절은 다시 시도할 시각을 한국 시간으로 보인다', () => {
    expect(
      waybillFailureText({
        status: 'pending',
        lastError: 'allocate ERROR-06: transient, retry after 2026-11-17T15:00:00.000Z',
      }),
    ).toMatch(/^운송사가 지금은 받지 않아요 \(ERROR-06\) — 11\. 18\. 오전 12:00 이후 다시 시도해요$/);
  });

  it('운송사 결과를 모르면 실패로 단정하지 않는다', () => {
    expect(waybillFailureText({ status: 'pending', lastError: null })).toBe(
      '운송사 응답을 확인하지 못했어요 — 상자 화면에서 송장 상태를 확인해요',
    );
    expect(waybillFailureText({ status: 'allocated', lastError: null })).toBe(
      '운송사 응답을 확인하지 못했어요 — 상자 화면에서 송장 상태를 확인해요',
    );
    expect(waybillFailureText({ status: 'abandoned', lastError: null })).toBe(
      '운송사 응답을 확인하지 못해 발급을 멈췄어요 — 상자 화면에서 송장 상태를 확인해요',
    );
    expect(waybillFailureText({ status: 'failed', lastError: 'allocate Error: socket hang up' })).toBe(
      '송장 발급 중 오류가 났어요 — 상자 화면에서 송장 상태를 확인해요',
    );
  });

  it('앞 단계의 기록이 남아 있어도 지금 상태로 읽는다', () => {
    const earlier = 'allocate ERROR-05: transient, retry after 2026-11-17T15:00:00.000Z';

    expect(waybillFailureText({ status: 'allocated', lastError: earlier })).toBe(
      '운송사 응답을 확인하지 못했어요 — 상자 화면에서 송장 상태를 확인해요',
    );
    expect(waybillFailureText({ status: 'abandoned', lastError: earlier })).toBe(
      '운송사 응답을 확인하지 못해 발급을 멈췄어요 — 상자 화면에서 송장 상태를 확인해요',
    );
    expect(waybillFailureText({ status: 'pending', lastError: 'allocate ERROR-01' })).toBe(
      '운송사 응답을 확인하지 못했어요 — 상자 화면에서 송장 상태를 확인해요',
    );
    expect(waybillFailureText({ status: 'failed', lastError: null })).toBe(
      '송장 발급 중 오류가 났어요 — 상자 화면에서 송장 상태를 확인해요',
    );
  });

  it('발급된 송장과 취소한 송장은 사유가 없다', () => {
    expect(waybillFailureText({ status: 'registered', lastError: null })).toBeNull();
    expect(waybillFailureText({ status: 'used', lastError: 'allocate ERROR-01' })).toBeNull();
    expect(waybillFailureText({ status: 'voided', lastError: null })).toBeNull();
  });
});
