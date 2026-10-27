import { MedusaError } from '@medusajs/framework/utils';

import { parseInput } from '../parse-input';

describe('return prepay parseInput', () => {
  const base = { requestId: ' r1 ', memo: '먼저 환불' };

  it('requestId 를 다듬고, amount·refundMode 가 없으면 칸이 없다, memo 는 그대로', () => {
    expect(parseInput(base)).toEqual({ requestId: 'r1', memo: '먼저 환불' });
    expect(parseInput({ ...base, memo: ' 앞뒤 공백 ' }).memo).toBe(' 앞뒤 공백 ');
  });
  it('amount·refundMode 를 싣는다', () => {
    expect(parseInput({ ...base, amount: 10000, refundMode: 'manual' })).toEqual({
      requestId: 'r1',
      amount: 10000,
      refundMode: 'manual',
      memo: '먼저 환불',
    });
  });
  it('memo 500자는 받는다', () => {
    expect(parseInput({ ...base, memo: 'a'.repeat(500) }).memo).toHaveLength(500);
  });
  it.each([
    [{}],
    [{ requestId: ' ', memo: 'm' }],
    [{ requestId: 'r' }],
    [{ requestId: 'r', memo: ' \n ' }],
    [{ requestId: 'r', memo: 'a'.repeat(501) }],
    [{ ...base, amount: 0 }],
    [{ ...base, amount: -1 }],
    [{ ...base, amount: 1.5 }],
    [{ ...base, amount: '10000' }],
    [{ ...base, refundMode: 'MANUAL' }],
  ])('INVALID_DATA: %j', (body) => {
    try {
      parseInput(body);
      throw new Error('던지지 않았다');
    } catch (e) {
      expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
    }
  });
});
