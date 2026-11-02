import { NO_ROWS_ONLY_EXIT } from '../../isolation-check/runner';
import { isolationGatePasses } from './isolation-gate';

/**
 * 직원 단계의 격리 실측 게이트. 새 테넌트는 상품이 0 이라 읽기 전용 실측이 상세 화면을 영영 못 연다 —
 * 그래서 첫 직원을 만들 수 없었다(테넌트 2 개통, 2026-11-03). 그 실패만 남았을 때는 쓰기 실측이 행을 만들어 잰다.
 */
describe('isolationGatePasses', () => {
  const runner = (codes: { read: number; write?: number }) =>
    jest.fn((write: boolean) => (write ? (codes.write ?? 0) : codes.read));

  it('읽기 전용이 초록이면 쓰기 실측을 돌리지 않는다', () => {
    const run = runner({ read: 0 });
    expect(isolationGatePasses(run)).toBe(true);
    expect(run.mock.calls).toEqual([[false]]);
  });

  it('«행이 없어 못 잼»만 남았으면 쓰기 실측으로 다시 잰다', () => {
    const run = runner({ read: NO_ROWS_ONLY_EXIT, write: 0 });
    expect(isolationGatePasses(run)).toBe(true);
    expect(run.mock.calls).toEqual([[false], [true]]);
  });

  it('쓰기 실측도 빨가면 통과가 아니다', () => {
    expect(isolationGatePasses(runner({ read: NO_ROWS_ONLY_EXIT, write: 1 }))).toBe(false);
  });

  it('다른 실패면 쓰기 실측 없이 거절한다', () => {
    const run = runner({ read: 1 });
    expect(isolationGatePasses(run)).toBe(false);
    expect(run.mock.calls).toEqual([[false]]);
  });
});
