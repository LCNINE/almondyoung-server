/**
 * 로컬 자사몰 주문 경로(#1440) — 스택(`start:all:local`)이 뜬 뒤 부른다. 판정은 preflight 가, 만들기는 이 명령이 한다.
 *
 *   npm run seed:order-path:local              # 주문 가능한 상품을 멱등으로 갖춘다
 *   npm run order:place:local -- --count 3     # 자사몰 주문을 넣고 부천 상자·예약까지 기다린다
 *
 * 절차·판정 쿼리: docs/local-e2e-environment.md «주문 한 건을 끝까지».
 */
import { signInStaff } from '../../tenancy/staff-token';
import { loadOrderPathConfig, TENANT_ONE, type OrderPathConfig } from './config';
import { ensureOrderPathProducts } from './products';

async function staffToken(cfg: OrderPathConfig): Promise<string> {
  return signInStaff(cfg.adminWebClient, 'admin', cfg.adminPassword, TENANT_ONE);
}

async function seed(cfg: OrderPathConfig): Promise<void> {
  const seeded = await ensureOrderPathProducts(cfg, await staffToken(cfg));
  console.table(
    seeded.map((s) => ({
      상품: s.productName,
      masterId: s.masterId,
      variantId: s.variantId,
      medusaVariantId: s.medusaVariantId,
      skuId: s.skuId,
      부천가용: s.available,
    })),
  );
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const cfg = loadOrderPathConfig();
  switch (command) {
    case 'seed':
      return seed(cfg);
    default:
      throw new Error(`알 수 없는 명령: ${command ?? '(없음)'} — seed 또는 order`);
  }
}

main().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
