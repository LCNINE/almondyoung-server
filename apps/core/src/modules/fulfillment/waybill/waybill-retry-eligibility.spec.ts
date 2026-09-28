import { isRetryableTransientRow } from './waybill.manager';
import type { WaybillRow } from './waybill.types';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function row(): WaybillRow {
  return {
    id: 'w1',
    status: 'pending',
    transientAttempts: 1,
    manifestVersion: 3,
    recipientHash: HASH_A,
  } as WaybillRow;
}

function rowWith(over: Partial<WaybillRow>): WaybillRow {
  return { ...row(), ...over } as WaybillRow;
}

describe('isRetryableTransientRow — 발급 배치가 기존 행을 재구동해도 되는가 (#914)', () => {
  it('일시적 거절로 멈춘 pending 은 재구동 대상이다', () => {
    expect(isRetryableTransientRow(row(), 3, HASH_A)).toBe(true);
  });

  // 방금 다른 요청이 만들어 진행 중인 pending 을 두 번 태우지 않기 위한 조건.
  it('일시적 거절을 겪은 적 없는 pending(transientAttempts=0)은 대상이 아니다', () => {
    expect(isRetryableTransientRow(rowWith({ transientAttempts: 0 }), 3, HASH_A)).toBe(false);
  });

  it('allocated 는 대상이 아니다 — 이미 채번됐고 해제는 운영자 abandon 의 몫이다', () => {
    expect(isRetryableTransientRow(rowWith({ status: 'allocated' }), 3, HASH_A)).toBe(false);
  });

  it('manifestVersion 이 바뀌었으면 대상이 아니다', () => {
    expect(isRetryableTransientRow(row(), 4, HASH_A)).toBe(false);
  });

  // 수하인만 바뀌면 manifestVersion 은 그대로일 수 있다 — 버전 비교만으로는 «주소가 바뀐 상자»를
  // 옛 내용으로 발급하게 된다.
  it('수하인 해시가 바뀌었으면 버전이 같아도 대상이 아니다', () => {
    expect(isRetryableTransientRow(row(), 3, HASH_B)).toBe(false);
  });
});
