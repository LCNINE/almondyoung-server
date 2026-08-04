import {
  isReservedRowKey,
  RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE,
  reservedRowKeyUnresolvedMessage,
} from './bulk-session.row-key';

describe('isReservedRowKey', () => {
  it('시스템 발급 형식(P- + 숫자 6자리)을 예약으로 본다', () => {
    expect(isReservedRowKey('P-000001')).toBe(true);
    expect(isReservedRowKey('P-999999')).toBe(true);
  });

  it('앞뒤 공백은 무시한다 — 엑셀 셀에서 흔히 섞인다', () => {
    expect(isReservedRowKey('  P-000001  ')).toBe(true);
  });

  it('자릿수가 다르면 예약이 아니다', () => {
    expect(isReservedRowKey('P-1')).toBe(false);
    expect(isReservedRowKey('P-0000001')).toBe(false);
  });

  it('사람이 지을 법한 키는 예약이 아니다', () => {
    expect(isReservedRowKey('NEW-001')).toBe(false);
    expect(isReservedRowKey('P-ABC123')).toBe(false);
    expect(isReservedRowKey('')).toBe(false);
  });
});

describe('오류 문구', () => {
  it('양식 정보 유실 문구는 재다운로드와 신규 키 대안을 둘 다 안내한다', () => {
    expect(RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE).toContain('양식을 다시');
    expect(RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE).toContain('P-000001');
  });

  it('미해석 문구는 문제의 상품키를 싣는다', () => {
    expect(reservedRowKeyUnresolvedMessage('P-000042')).toContain('P-000042');
  });
});
