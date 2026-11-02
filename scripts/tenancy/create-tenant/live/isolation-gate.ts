import { NO_ROWS_ONLY_EXIT } from '../../isolation-check/runner';

/**
 * 직원 계정을 만들기 전의 격리 실측. 읽기 전용이 «행이 없어 못 잼»만으로 빨가면(새 테넌트 — 상품 0)
 * 쓰기 실측으로 다시 잰다. 쓰기 실측은 테넌트를 잠깐 «정지»했다 되돌리므로, 이미 직원이 있는 테넌트라면
 * 그 사이 그들의 요청이 거절된다 — 상품이 생긴 뒤엔 읽기 전용이 초록이라 이 길로 오지 않는다.
 *
 * `run(write)` 은 실측 스크립트의 종료코드를 돌려준다.
 */
export function isolationGatePasses(run: (write: boolean) => number): boolean {
  const read = run(false);
  if (read === 0) return true;
  if (read !== NO_ROWS_ONLY_EXIT) return false;
  console.log(
    '\n읽기 전용 실측이 «행이 없어 못 잼»만 남겼다 — 쓰기 실측(--write)으로 다시 잰다(운영자 로그인을 한 번 더 묻는다).',
  );
  return run(true) === 0;
}
