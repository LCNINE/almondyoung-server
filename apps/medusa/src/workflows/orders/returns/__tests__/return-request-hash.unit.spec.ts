import { hashReturnRequest } from '../return-request-hash';

const items = [{ itemId: 'item_01', quantity: 2 }];

describe('hashReturnRequest (K8 PR11 N1)', () => {
  // PR 11 이전 구현(items·reasonValue·operatorFeeBearer 본문)에서 계산한 고정 값 — 옛 반품의 재전송이 conflict 가 되면 안 된다
  it('kind 가 없거나 return 이면 PR 11 이전과 바이트 단위로 같다', () => {
    const pinned = '0e113d79c728d76e2384eb5ac1b29bcdda3d16447e50c6a8d640afd12e3726a0';
    expect(hashReturnRequest(items, 'change_of_mind', undefined)).toBe(pinned);
    expect(hashReturnRequest(items, 'change_of_mind', undefined, undefined)).toBe(pinned);
    expect(hashReturnRequest(items, 'change_of_mind', undefined, 'return')).toBe(pinned);
    expect(hashReturnRequest([{ itemId: 'item_01', quantity: 1 }], 'other', 'seller')).toBe(
      '4b9f64013352f0b39908e66b8a9292361d7f20e048a86959dfbc005fa145bde2',
    );
  });

  it('exchange 는 다른 해시다', () => {
    expect(hashReturnRequest(items, 'defective', undefined, 'exchange')).not.toBe(
      hashReturnRequest(items, 'defective', undefined),
    );
  });
});
