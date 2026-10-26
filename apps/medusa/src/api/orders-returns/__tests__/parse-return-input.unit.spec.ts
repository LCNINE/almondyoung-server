import { MedusaError } from '@medusajs/framework/utils';

import { parseReturnRequestBody } from '../parse-return-input';

const base = { request_id: 'r-1', items: [{ item_id: 'it_1', quantity: 2 }], reason: 'change_of_mind' };

const invalid = (body: unknown, scope: 'store' | 'admin' = 'store') => {
  try {
    parseReturnRequestBody(body, scope);
  } catch (e) {
    expect(e).toBeInstanceOf(MedusaError);
    expect((e as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA);
    return;
  }
  throw new Error('던지지 않았다');
};

describe('parseReturnRequestBody', () => {
  it('store 본문을 camelCase 입력으로 바꾼다(requestId 는 trim)', () => {
    expect(parseReturnRequestBody({ ...base, request_id: ' r-1 ', note: '메모' }, 'store')).toEqual({
      requestId: 'r-1',
      items: [{ itemId: 'it_1', quantity: 2 }],
      reasonValue: 'change_of_mind',
      note: '메모',
    });
  });

  it('admin 은 fee_bearer·window_override_reason 을 받는다', () => {
    expect(
      parseReturnRequestBody({ ...base, reason: 'other', fee_bearer: 'seller', window_override_reason: '고객센터 합의' }, 'admin'),
    ).toMatchObject({ operatorFeeBearer: 'seller', windowOverrideReason: '고객센터 합의' });
  });

  it('빈 request_id → INVALID_DATA', () => {
    invalid({ ...base, request_id: '  ' });
    invalid({ ...base, request_id: undefined });
  });

  it('빈 items → INVALID_DATA', () => {
    invalid({ ...base, items: [] });
    invalid({ ...base, items: undefined });
  });

  it('정수 아닌/0 이하 수량 → INVALID_DATA', () => {
    for (const quantity of [0, -1, 1.5, '2', null]) invalid({ ...base, items: [{ item_id: 'it_1', quantity }] });
  });

  it('같은 item_id 중복 → INVALID_DATA', () => {
    invalid({ ...base, items: [{ item_id: 'it_1', quantity: 1 }, { item_id: 'it_1', quantity: 1 }] });
  });

  it('문자열 아닌 reason → INVALID_DATA', () => {
    invalid({ ...base, reason: 3 });
    invalid({ ...base, reason: '' });
  });

  it('문자열 아닌 note → INVALID_DATA', () => {
    invalid({ ...base, note: 3 });
  });

  it('store 범위의 fee_bearer·window_override_reason → INVALID_DATA(고객이 CS 권한을 흉내 내지 못한다)', () => {
    invalid({ ...base, fee_bearer: 'seller' });
    invalid({ ...base, window_override_reason: 'x' });
  });

  it('admin 의 fee_bearer 가 어휘 밖이면 INVALID_DATA', () => {
    invalid({ ...base, fee_bearer: 'operator' }, 'admin');
  });
});
