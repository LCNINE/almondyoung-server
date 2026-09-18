import { composeSmsBody } from './sms-body';

describe('composeSmsBody', () => {
  it('광고는 서버와 같은 최종 본문을 만든다', () => {
    expect(composeSmsBody('MARKETING', '(광고)가을 신상')).toBe("(광고) 가을 신상\n수신거부: 이 번호로 '수신거부' 회신");
  });

  it('정보성은 본문 그대로', () => {
    expect(composeSmsBody('INFORMATIONAL', '배송 안내')).toBe('배송 안내');
  });
});
