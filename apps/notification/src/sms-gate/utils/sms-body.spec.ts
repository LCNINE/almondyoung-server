import { composeSmsBody, fillName, isMarketingQuietHours } from './sms-body';

describe('composeSmsBody', () => {
  it('정보성은 본문 그대로', () => {
    expect(composeSmsBody('INFORMATIONAL', ' 배송이 늦어집니다 ')).toBe('배송이 늦어집니다');
  });

  it('광고는 맨 앞 (광고) 와 맨 끝 수신거부 안내를 붙인다', () => {
    expect(composeSmsBody('MARKETING', '가을 신상')).toBe("(광고) 가을 신상\n수신거부: 이 번호로 '수신거부' 회신");
  });

  it('작성자가 (광고) 를 이미 넣었으면 중복하지 않는다', () => {
    expect(composeSmsBody('MARKETING', '(광고)가을 신상')).toBe("(광고) 가을 신상\n수신거부: 이 번호로 '수신거부' 회신");
  });
});

describe('isMarketingQuietHours', () => {
  it('KST 21시부터 다음날 8시 전까지 광고 금지', () => {
    expect(isMarketingQuietHours(new Date('2026-09-18T11:59:00Z'))).toBe(false);
    expect(isMarketingQuietHours(new Date('2026-09-18T12:00:00Z'))).toBe(true);
    expect(isMarketingQuietHours(new Date('2026-09-18T22:59:00Z'))).toBe(true);
    expect(isMarketingQuietHours(new Date('2026-09-18T23:00:00Z'))).toBe(false);
  });
});

describe('fillName', () => {
  it('{{이름}} 을 모두 수신자 이름으로 바꾼다', () => {
    expect(fillName('{{이름}}님, {{이름}}님께 드리는 혜택', '홍길동')).toBe('홍길동님, 홍길동님께 드리는 혜택');
  });
});
