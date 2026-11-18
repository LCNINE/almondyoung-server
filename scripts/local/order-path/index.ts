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
import { customerSession, ensureBuyer } from './buyer';
import { placeMedusaOrder } from './checkout';
import { syncAndWaitForBox } from './follow';
import { recipientFor } from './plan';

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

/** KST yyyyMMddHHmmss — 상세주소에 넣어 앞 실행의 안 나간 상자와 합배송 묶음이 되지 않게 한다. */
function runStamp(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14);
}

function countArg(argv: string[]): number {
  const i = argv.indexOf('--count');
  const n = i >= 0 ? Number(argv[i + 1]) : 1;
  if (!Number.isInteger(n) || n < 1) throw new Error(`--count 는 1 이상의 정수다: ${argv[i + 1]}`);
  return n;
}

async function order(cfg: OrderPathConfig, count: number): Promise<void> {
  const token = await staffToken(cfg);
  const variants = await ensureOrderPathProducts(cfg, token, () => undefined);
  const { userId } = await ensureBuyer(cfg);
  const session = await customerSession(cfg, userId);
  const stamp = runStamp();
  const boxes: string[] = [];
  let failed = 0;
  for (let seq = 1; seq <= count; seq++) {
    const variant = variants[(seq - 1) % variants.length];
    try {
      const { medusaOrderId } = await placeMedusaOrder(cfg, session, variant, recipientFor(stamp, seq));
      const { salesOrderId, shipmentIds } = await syncAndWaitForBox(cfg, token, medusaOrderId);
      boxes.push(...shipmentIds);
      console.log(`✓ ${seq}/${count} Medusa ${medusaOrderId} → core ${salesOrderId} → 상자 ${shipmentIds.join(', ')}`);
    } catch (error: unknown) {
      failed += 1;
      console.error(`✗ ${seq}/${count} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // #1249 의 local/compare.ts --normal <id,…> --emergency <id,…> 에 그대로 붙일 수 있는 한 줄.
  console.log(`상자: ${boxes.join(',')}`);
  if (failed > 0) throw new Error(`${failed}/${count} 건 실패`);
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const cfg = loadOrderPathConfig();
  switch (command) {
    case 'seed':
      return seed(cfg);
    case 'order':
      return order(cfg, countArg(process.argv));
    default:
      throw new Error(`알 수 없는 명령: ${command ?? '(없음)'} — seed 또는 order`);
  }
}

main().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
