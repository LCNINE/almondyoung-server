import { isRecipientComplete, missingRecipientFields } from './recipient-completeness';

describe('recipient completeness', () => {
  const recipient = {
    recipientName: '수령인',
    phone: '010-1234-5678',
    postalCode: '12345',
    roadAddress: '테스트 도로 1',
  };

  it('상세주소가 없어도 필수 필드가 모두 있으면 완전하다', () => {
    expect(isRecipientComplete(recipient)).toBe(true);
    expect(missingRecipientFields(recipient)).toEqual([]);
  });

  it.each(['recipientName', 'phone', 'postalCode', 'roadAddress'])('%s의 공백과 문자열 외 값을 거부한다', (field) => {
    for (const value of ['  ', '', null, undefined, 123]) {
      const snapshot = { ...recipient, [field]: value };

      expect(isRecipientComplete(snapshot)).toBe(false);
      expect(missingRecipientFields(snapshot)).toEqual([field]);
    }
  });

  it.each([null, undefined, '', 123, []])('수령인 객체가 아니면 모든 필드가 누락된다: %p', (snapshot) => {
    expect(isRecipientComplete(snapshot)).toBe(false);
    expect(missingRecipientFields(snapshot)).toEqual(['recipientName', 'phone', 'postalCode', 'roadAddress']);
  });
});
