import {
  buildDefaultShippingMemoMetadata,
  buildClearedDefaultShippingMemoMetadata,
} from '../metadata';

describe('buildDefaultShippingMemoMetadata', () => {
  it('메모 유형과 공동현관 유무를 저장한다', () => {
    const result = buildDefaultShippingMemoMetadata({
      shipping_memo_type: 'door',
      shipping_memo_custom: '',
      has_entrance: true,
    });

    expect(result.default_shipping_memo_type).toBe('door');
    expect(result.default_has_entrance).toBe(true);
  });

  it('공동현관 비밀번호는 저장하지 않는다 — 만료 개념이 없는 저장소라 무기한 보관이 된다', () => {
    const result = buildDefaultShippingMemoMetadata({
      shipping_memo_type: 'door',
      has_entrance: true,
      // 옛 클라이언트가 보내와도 흘려보내지 않는다
      entrance_password: '#1234',
    } as Parameters<typeof buildDefaultShippingMemoMetadata>[0]);

    expect(JSON.stringify(result)).not.toContain('1234');
  });

  it('과거에 저장된 비밀번호가 있으면 이 요청으로 함께 파기한다', () => {
    const result = buildDefaultShippingMemoMetadata({
      shipping_memo_type: 'security',
    });

    // Medusa 는 metadata 를 병합하며 빈 문자열을 키 삭제로 처리한다.
    expect(result.default_entrance_password).toBe('');
  });

  it('기타 유형이 아니면 직접 입력 문구를 비운다', () => {
    const result = buildDefaultShippingMemoMetadata({
      shipping_memo_type: 'door',
      shipping_memo_custom: '옆집에 맡겨주세요',
    });

    expect(result.default_shipping_memo_custom).toBe('');
  });

  it('기타 유형이면 직접 입력 문구를 보존한다', () => {
    const result = buildDefaultShippingMemoMetadata({
      shipping_memo_type: 'other',
      shipping_memo_custom: '옆집에 맡겨주세요',
    });

    expect(result.default_shipping_memo_custom).toBe('옆집에 맡겨주세요');
  });

  it('기존 metadata 를 스프레드하지 않는다 — Medusa 가 병합하므로 다른 키를 실어보낼 이유가 없다', () => {
    const result = buildDefaultShippingMemoMetadata({ shipping_memo_type: 'door' });

    expect(Object.keys(result).sort()).toEqual([
      'default_entrance_password',
      'default_has_entrance',
      'default_shipping_memo_custom',
      'default_shipping_memo_type',
    ]);
  });
});

describe('buildClearedDefaultShippingMemoMetadata', () => {
  it('네 키를 모두 빈 문자열로 보내 실제로 삭제되게 한다', () => {
    // 키를 뺀 객체를 보내면 Medusa 의 병합 때문에 옛 값이 그대로 남는다.
    expect(buildClearedDefaultShippingMemoMetadata()).toEqual({
      default_shipping_memo_type: '',
      default_shipping_memo_custom: '',
      default_entrance_password: '',
      default_has_entrance: '',
    });
  });
});
