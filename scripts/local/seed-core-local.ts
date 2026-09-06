/**
 * 로컬 core DB(`dev_core`)에 reference 시드를 적용한다.
 *
 * `npm run db:seed:ref` 는 SST/AWS 에서 배포 설정을 읽어 DB URL 을 해석하므로 로컬에서는 못 쓴다.
 * `seed-user-service-local.ts` · `seed-wallet-local.ts` 와 같은 방식으로, 같은 SeedStep 을
 * 로컬 DATABASE_URL 로 직접 돌린다 — 시드 정의가 한 곳(정본)에 남아 로컬과 라이브가 갈리지 않는다.
 *
 * 무엇이 없어서 무엇이 막히는가:
 *
 * 1. `PimSeedStep` — `sales_channels` 의 `site='medusa'` 활성 채널 1행.
 *    🔴 이게 없으면 channel-adapter 의 주문 수집 게이트가 닫힌 채로 **조용히** 매 주기를 건너뛴다.
 *    (`OrderPollerOrchestrator` 는 활성 채널만 폴링한다) → 스토어프론트에서 주문을 만들어도
 *    core `sales_orders` 에 영영 안 들어오고, 어드민 주문조회는 그냥 「0건」이다.
 *
 * 2. `SupplierLocalSeedStep` — 「개발용 공급처」 1행.
 *    🔴 이게 없으면 매칭 다이얼로그의 **공급처(발주처) 드롭다운이 비어** 필수 3칸 중 하나를
 *    못 채우고 저장이 안 열린다. 물류처·재고소유는 core 부팅이 수렴시키는데 공급처만 그 경로가
 *    없다. 발주도 같이 막힌다 (#795).
 *
 * 3. `ProductMatchingBackfillSeedStep` — active variant 마다 `product_matchings` pending 행.
 *    🔴 이게 없으면 어드민 매칭 화면에서 「이 주문의 매칭 레코드가 없습니다」가 뜨고
 *    필수값을 다 채워도 「자동 SKU 구성 매칭」 버튼이 열리지 않는다.
 *    **상품을 새로 발행할 때마다 다시 돌려야 한다** — 발행 자체는 매칭 레코드를 만들지 않는다.
 *
 * 사용: npm run db:seed:core:local
 *
 * ⚠️ `scripts/local/seed-dev-core` 와는 다른 물건이다. 그쪽은 `dev_core` 를 **drop/create** 하고
 * 창고·SKU·주문 픽스처를 채우는 개발용 시드다. 이 스크립트는 파괴적이지 않고 멱등이다.
 */
import { SeedStep } from '../seeding/steps/base-seed-step';
import { PimSeedStep } from '../seeding/steps/pim.seed-step';
import { ProductMatchingBackfillSeedStep } from '../seeding/steps/product-matching-backfill.seed-step';
// 공급처는 라이브에 실제 행이 있어 reference 시드로 올리면 안 된다 — 그래서 이 스텝만
// `scripts/local/` 에 있고 orchestrator 에 등록돼 있지 않다. 근거는 그 파일 머리말.
import { SupplierLocalSeedStep } from './supplier.seed-step';

const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
// apps/core/.env 가 쓰는 DB 는 `core` 가 아니라 `dev_core` 다 (docs/local-e2e-environment.md §2).
const DATABASE_URL = process.env.CORE_DATABASE_URL ?? `${LOCAL_PG}/dev_core`;

if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  throw new Error(`로컬 전용 스크립트다. DATABASE_URL 이 localhost 가 아니다: ${DATABASE_URL}`);
}

async function runStep(step: SeedStep, label: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  console.log('[check-before]', JSON.stringify(await step.check(), null, 2));
  const applied = await step.apply();
  console.log('[apply]', JSON.stringify(applied, null, 2));
  console.log('[check-after]', JSON.stringify(await step.check(), null, 2));
  // `apply()` 는 던지지 않고 `success:false` 를 돌려준다. 출력만 하면 UNIQUE 위반 같은 실패가
  // 스크롤에 묻힌 채 exit 0 으로 끝나, 시드가 됐다고 믿고 다음 단계로 넘어가게 된다.
  if (!applied.success) {
    throw new Error(`${label} 시드 실패: ${applied.error ?? '(원인 미상)'}`);
  }
}

async function main(): Promise<void> {
  console.log(`대상: ${DATABASE_URL}`);
  // 순서가 있다: 채널이 먼저 있어야 수집이 열리고, 매칭 backfill 은 variant 를 훑으므로 뒤에 온다.
  // 공급처는 다른 스텝과 무관하지만 마스터데이터라 backfill 앞에 둔다.
  await runStep(new PimSeedStep(DATABASE_URL), 'PIM (sales_channels)');
  await runStep(new SupplierLocalSeedStep(DATABASE_URL), '공급처 (suppliers)');
  await runStep(new ProductMatchingBackfillSeedStep(DATABASE_URL), 'ProductMatching backfill');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
