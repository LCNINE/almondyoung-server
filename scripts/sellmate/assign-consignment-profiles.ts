/**
 * 위탁 업체 화주의 SKU 를 그 업체 배송 프로필로 옮긴다.
 * 송장의 보내는 분은 상자의 배송 프로필에서 읽고, 상자의 프로필은 SKU 의 프로필로 정해진다.
 * 그래서 위탁 SKU 가 기본 프로필에 남아 있으면 업체 물건도 우리 이름으로 나간다.
 *
 * 업체 프로필 = holder_id 가 그 화주이고 3pl 을 지원하는 배송 프로필. 어드민 배송 프로필 화면에서 먼저 만든다.
 * - 업체 프로필이 하나면 그 업체의 삭제 안 된 SKU 를 전부 그 프로필로 옮긴다
 * - 없거나 둘 이상이면 건드리지 않고 보고만 한다
 *
 * 기본은 dry-run(읽기 전용 트랜잭션).
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live assign-consignment-profiles
 *   bash scripts/sellmate/run.sh live assign-consignment-profiles --apply
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, arrayContains, eq, inArray, ne, or, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { parseCliArgs } from './register-missing-barcodes';

export interface ProfilePlanRow {
  holderId: string;
  holderName: string;
  profileId: string | null;
  problem: '프로필 없음' | '프로필 여러 개' | null;
  toMove: number;
}

export async function readConsignmentProfilePlan(tx: DbTx): Promise<ProfilePlanRow[]> {
  const { holders, deliveryProfiles, skus } = wmsTables;
  const vendorHolders = await tx
    .select({ id: holders.id, name: holders.name })
    .from(holders)
    .where(eq(holders.isOurAsset, false))
    .orderBy(holders.name);

  if (vendorHolders.length === 0) return [];

  const profiles = await tx
    .select({ id: deliveryProfiles.id, holderId: deliveryProfiles.holderId })
    .from(deliveryProfiles)
    .where(
      and(
        inArray(
          deliveryProfiles.holderId,
          vendorHolders.map((h) => h.id),
        ),
        arrayContains(deliveryProfiles.supportedFulfillmentModes, ['3pl']),
      ),
    );

  const plan: ProfilePlanRow[] = [];

  for (const holder of vendorHolders) {
    const own = profiles.filter((p) => p.holderId === holder.id);

    if (own.length !== 1) {
      plan.push({
        holderId: holder.id,
        holderName: holder.name,
        profileId: null,
        problem: own.length === 0 ? '프로필 없음' : '프로필 여러 개',
        toMove: 0,
      });
      continue;
    }

    const rows = await tx
      .select({ id: skus.id })
      .from(skus)
      .where(
        and(
          eq(skus.holderId, holder.id),
          eq(skus.isDeleted, false),
          or(isNull(skus.deliveryProfileId), ne(skus.deliveryProfileId, own[0].id)),
        ),
      );

    plan.push({
      holderId: holder.id,
      holderName: holder.name,
      profileId: own[0].id,
      problem: null,
      toMove: rows.length,
    });
  }

  return plan;
}

export async function applyConsignmentProfilePlan(tx: DbTx, plan: readonly ProfilePlanRow[]): Promise<number> {
  const { skus } = wmsTables;
  let moved = 0;

  for (const row of plan) {
    if (!row.profileId || row.toMove === 0) continue;

    const updated = await tx
      .update(skus)
      .set({ deliveryProfileId: row.profileId })
      .where(
        and(
          eq(skus.holderId, row.holderId),
          eq(skus.isDeleted, false),
          or(isNull(skus.deliveryProfileId), ne(skus.deliveryProfileId, row.profileId)),
        ),
      )
      .returning({ id: skus.id });
    moved += updated.length;
  }

  return moved;
}

function printPlan(plan: readonly ProfilePlanRow[]): void {
  for (const row of plan) {
    console.log(`  ${row.holderName}: ${row.problem ?? `옮길 SKU ${row.toMove}`}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB). 라이브는 scripts/sellmate/run.sh');
    process.exit(1);
  }

  const { apply } = parseCliArgs(process.argv.slice(2), process.env);
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    if (!apply) {
      await db.transaction(
        async (tx) => {
          printPlan(await readConsignmentProfilePlan(tx));
          console.log('\n🧪 DRY-RUN — 아무것도 바꾸지 않았습니다. 반영하려면 --apply');
        },
        { accessMode: 'read only' },
      );

      return;
    }

    await db.transaction(async (tx) => {
      const plan = await readConsignmentProfilePlan(tx);

      printPlan(plan);
      console.log(`\n✅ 적용 — 옮김 ${await applyConsignmentProfilePlan(tx, plan)}`);
    });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
