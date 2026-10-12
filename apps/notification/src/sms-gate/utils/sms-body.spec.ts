import { composeSmsBody, fillName, isMarketingQuietHours, longestFilledName } from './sms-body';

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

  it('이름의 $ 는 치환 패턴으로 해석하지 않는다', () => {
    expect(fillName('{{이름}}님', "a$&b$$c$'")).toBe("a$&b$$c$'님");
  });

  it('이름이 비었거나 숫자뿐이면 원장으로 부른다', () => {
    expect(fillName('{{이름}}님, 안녕하세요', '5791')).toBe('원장님, 안녕하세요');
    expect(fillName('{{이름}}님', '010-1234-5678')).toBe('원장님');
    expect(fillName('{{이름}}님', ' ')).toBe('원장님');
    expect(fillName('{{이름}}님', '')).toBe('원장님');
  });

  it('숫자가 섞인 상호는 그대로 쓴다', () => {
    expect(fillName('{{이름}}님', '뷰티24')).toBe('뷰티24님');
  });
});

describe('longestFilledName', () => {
  it('발송 때 채워질 이름 중 가장 긴 것을 고른다', () => {
    expect(longestFilledName(['김철수', '소랑뷰티 반영구', '010-1234-5678'])).toBe('소랑뷰티 반영구');
  });

  it('이름 대신 번호가 든 수신자는 대체 이름으로 센다', () => {
    expect(longestFilledName(['010-1234-5678'])).toBe('원장');
  });

  it('수신자가 없으면 null', () => {
    expect(longestFilledName([])).toBeNull();
  });
});
