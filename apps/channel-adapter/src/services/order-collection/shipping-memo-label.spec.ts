import { buildDeliveryNote, readEntrancePassword } from './shipping-memo-label';

describe('buildDeliveryNote', () => {
  it('문앞 유형을 사람이 읽는 라벨로 바꾼다', () => {
    expect(buildDeliveryNote({ shipping_memo_type: 'door' })).toBe('문 앞에 놓아주세요');
  });

  it('기타 유형은 고객이 직접 쓴 문구를 그대로 쓴다', () => {
    expect(buildDeliveryNote({ shipping_memo_type: 'other', shipping_memo_custom: '옆집에 맡겨주세요' })).toBe(
      '옆집에 맡겨주세요',
    );
  });

  it('기타인데 직접 입력이 비어 있으면 메모가 없는 것으로 본다', () => {
    expect(buildDeliveryNote({ shipping_memo_type: 'other', shipping_memo_custom: '' })).toBeUndefined();
  });

  it('메모가 없으면 undefined 를 준다', () => {
    expect(buildDeliveryNote({})).toBeUndefined();
    expect(buildDeliveryNote(null)).toBeUndefined();
  });

  it('모르는 유형은 undefined 를 준다 — 코드값이 송장에 그대로 찍히면 안 된다', () => {
    expect(buildDeliveryNote({ shipping_memo_type: 'teleport' })).toBeUndefined();
  });

  it('공동현관 비밀번호는 절대 라벨에 섞지 않는다', () => {
    const note = buildDeliveryNote({
      shipping_memo_type: 'door',
      has_entrance: true,
      entrance_password: '#1234',
    });
    expect(note).toBe('문 앞에 놓아주세요');
    expect(note).not.toContain('1234');
  });
});

describe('readEntrancePassword', () => {
  it('문앞 + 공동현관 있음이면 비번을 준다', () => {
    expect(
      readEntrancePassword({ shipping_memo_type: 'door', has_entrance: true, entrance_password: '#1234' }),
    ).toBe('#1234');
  });

  it('공동현관 없음이면 비번을 주지 않는다', () => {
    expect(
      readEntrancePassword({ shipping_memo_type: 'door', has_entrance: false, entrance_password: '#1234' }),
    ).toBeUndefined();
  });

  it('문앞이 아니면 비번을 주지 않는다', () => {
    expect(
      readEntrancePassword({ shipping_memo_type: 'security', has_entrance: true, entrance_password: '#1234' }),
    ).toBeUndefined();
  });

  it('비번 문자열이 비어 있으면 undefined 다', () => {
    expect(
      readEntrancePassword({ shipping_memo_type: 'door', has_entrance: true, entrance_password: '  ' }),
    ).toBeUndefined();
  });
});
