/**
 * 참조 시드 그룹. core DB 는 테넌트마다 따로라, core 참조 시드를 두 갈래로 나눈다.
 *
 * - «모든 테넌트»(`baseline`): 어느 테넌트 DB 에나 들어가야 앱이 도는 값 — 보충 기본값·등급 규칙.
 *   core 밖 서비스(user-service·wallet 등)의 참조 시드도 이 그룹이다. 그 DB 들은 테넌트가 함께 쓴다.
 * - «테넌트 1 전용»(`baseline-tenant-1`): 기존 core DB 에만 맞는 데이터 — 부천·중국 창고·구역·창고 설정,
 *   자사몰 판매채널. 새 테넌트 DB 에 넣으면 그 테넌트가 남의 창고·채널을 갖고 태어난다.
 *   창고 설정 두 키(`use_sub_barcode`·`use_expiry_separation`)는 읽는 코드가 없고, 상품 게시는
 *   판매채널 행 없이 된다 — 그래서 새 테넌트엔 이 갈래가 필요 없다.
 */
export const ALL_TENANTS_SEED_GROUP = 'baseline';
export const TENANT1_ONLY_SEED_GROUP = 'baseline-tenant-1';

const DEMO_GROUP_PREFIX = 'demo-';
const BACKFILL_GROUP = 'backfill';

/**
 * `db:seed:ref` 가 도는 그룹: demo- 와 backfill(사람이 명시적으로 고를 때만)을 뺀 전부.
 * 갈래를 어느 core DB 에 넣을지는 여기가 아니라 스텝을 만들 때 테넌트마다 정한다 — 테넌트 1 DB 엔 두 갈래,
 * 그 밖의 테넌트 DB 엔 «모든 테넌트» 갈래의 core 스텝만(`core-seed-steps.ts`).
 */
export function selectReferenceSeedGroups(all: readonly string[]): string[] {
  return all.filter((g) => !g.startsWith(DEMO_GROUP_PREFIX) && g !== BACKFILL_GROUP);
}
