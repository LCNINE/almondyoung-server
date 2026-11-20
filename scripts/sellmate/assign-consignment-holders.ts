/**
 * 위탁 업체 SKU 를 그 업체 화주(holders.is_our_asset=false)로 옮긴다.
 * 셀메이트에는 화주가 없어 sync-stock 이 위탁 상품도 자사 화주로 넣었다. T 전에 갈라 둬야
 * 자사몰 판매가능수량·보충 제안이 남의 재고를 세지 않는다.
 *
 * 입력: 두 열짜리 CSV/xlsx — 옵션정보일련번호(= skus.code), 업체(화주 이름).
 * 업체 목록은 공개 레포에 두지 않는다. 파일은 레포 밖에서 만든다.
 * - 이름이 같은 위탁 화주가 있으면 그 화주를 쓰고, 없으면 --apply 때 만든다
 * - 이미 다른 위탁 화주에 있는 SKU 는 옮기지 않고 보고만 한다(파일과 DB 중 무엇이 맞는지 사람이 본다)
 * - 한 SKU 에 업체가 둘 적혀 있으면 아무것도 하지 않고 멈춘다
 * - 파일에서 빠진 SKU 를 자사로 되돌리지 않는다. 되돌리려면 업체 칸에 자사 라고 적는다(기본 보유자로 옮긴다)
 *
 * 기본은 dry-run(읽기 전용 트랜잭션). 테넌트 1 core DB(run.sh 기본 DB_NAME=core)에만 쓴다.
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live assign-consignment-holders <업체 파일>
 *   bash scripts/sellmate/run.sh live assign-consignment-holders <업체 파일> --apply
 * 다시 돌린 dry-run 의 "옮길 것" 이 0 이면 끝이다.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { HOLDER_CONSTANTS } from '../../apps/core/src/modules/inventory/core/constants/holder.constants';
import { chunk, detectColumns, readRows } from './parse';
import { parseCliArgs } from './register-missing-barcodes';

const CHUNK = 1000;
const LIST_LIMIT = 10;
export const OUR_ASSET = '자사';

export interface VendorRow {
  skuCode: string;
  vendor: string;
}

export interface HolderMove {
  skuId: string;
  skuCode: string;
  vendor: string;
  fromHolderId: string;
}

export interface ConsignmentHolderPlan {
  /** 업체 이름 → 기존 위탁 화주 id. 없으면 null(--apply 때 만든다). */
  holders: Map<string, string | null>;
  move: HolderMove[];
  alreadyOk: number;
  /** 파일과 다른 위탁 화주에 이미 있는 SKU. 옮기지 않는다. */
  onOtherVendor: { skuCode: string; vendor: string; currentVendor: string }[];
  notInCore: string[];
  /** 업체 이름 → 옮길 SKU 의 재고 합. */
  stockByVendor: Map<string, number>;
}

export function parseVendorRows(rows: readonly string[][]): VendorRow[] {
  const [header, ...body] = rows;
  const cols = detectColumns(header ?? [], { skuCode: ['옵션정보일련번호'], vendor: ['업체', '화주'] });

  if (cols.skuCode < 0 || cols.vendor < 0) {
    throw new Error('열을 못 찾았습니다 — 첫 행에 "옵션정보일련번호", "업체" 가 있어야 합니다');
  }

  const vendorByCode = new Map<string, string>();

  for (const row of body) {
    const skuCode = (row[cols.skuCode] ?? '').trim();
    const vendor = (row[cols.vendor] ?? '').trim();

    if (!skuCode || !vendor) {
      continue;
    }

    const seen = vendorByCode.get(skuCode);

    if (seen !== undefined && seen !== vendor) {
      throw new Error(`한 SKU 에 업체가 둘입니다: ${skuCode} — ${seen} / ${vendor}`);
    }

    vendorByCode.set(skuCode, vendor);
  }

  return [...vendorByCode].map(([skuCode, vendor]) => ({ skuCode, vendor }));
}

export async function readConsignmentHolderPlan(tx: DbTx, rows: readonly VendorRow[]): Promise<ConsignmentHolderPlan> {
  const vendors = [...new Set(rows.map((r) => r.vendor))].filter((v) => v !== OUR_ASSET);
  const holderRows = vendors.length
    ? await tx
        .select({ id: wmsTables.holders.id, name: wmsTables.holders.name, isOurAsset: wmsTables.holders.isOurAsset })
        .from(wmsTables.holders)
        .where(inArray(wmsTables.holders.name, vendors))
    : [];
  const holders = new Map<string, string | null>(vendors.map((v) => [v, null]));

  for (const h of holderRows) {
    if (h.isOurAsset) {
      throw new Error(`자사 화주와 이름이 같습니다: ${h.name} — 위탁 화주로 쓸 수 없습니다`);
    }

    if (holders.get(h.name)) {
      throw new Error(`이름이 같은 위탁 화주가 둘입니다: ${h.name}`);
    }

    holders.set(h.name, h.id);
  }

  if (rows.some((r) => r.vendor === OUR_ASSET)) {
    holders.set(OUR_ASSET, HOLDER_CONSTANTS.DEFAULT_HOLDER.id);
  }

  const consignmentNameById = new Map<string, string>();
  const allConsignment = await tx
    .select({ id: wmsTables.holders.id, name: wmsTables.holders.name })
    .from(wmsTables.holders)
    .where(eq(wmsTables.holders.isOurAsset, false));

  for (const h of allConsignment) {
    consignmentNameById.set(h.id, h.name);
  }

  const plan: ConsignmentHolderPlan = {
    holders,
    move: [],
    alreadyOk: 0,
    onOtherVendor: [],
    notInCore: [],
    stockByVendor: new Map(),
  };
  const vendorByCode = new Map(rows.map((r) => [r.skuCode, r.vendor]));
  const found = new Set<string>();

  for (const part of chunk([...vendorByCode.keys()], CHUNK)) {
    const skus = await tx
      .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, holderId: wmsTables.skus.holderId })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.code, part));

    for (const sku of skus) {
      const vendor = vendorByCode.get(sku.code) as string; // ponytail: code 로 조회한 행이라 반드시 있다
      const currentVendor = consignmentNameById.get(sku.holderId);

      found.add(sku.code);

      if (vendor === OUR_ASSET) {
        if (currentVendor === undefined) {
          plan.alreadyOk++;
        } else {
          plan.move.push({ skuId: sku.id, skuCode: sku.code, vendor, fromHolderId: sku.holderId });
        }
      } else if (currentVendor === vendor) {
        plan.alreadyOk++;
      } else if (currentVendor !== undefined) {
        plan.onOtherVendor.push({ skuCode: sku.code, vendor, currentVendor });
      } else {
        plan.move.push({ skuId: sku.id, skuCode: sku.code, vendor, fromHolderId: sku.holderId });
      }
    }
  }

  plan.notInCore = [...vendorByCode.keys()].filter((code) => !found.has(code));

  const vendorBySkuId = new Map(plan.move.map((m) => [m.skuId, m.vendor]));

  for (const part of chunk([...vendorBySkuId.keys()], CHUNK)) {
    const sums = await tx
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}), 0)::int`,
      })
      .from(wmsTables.stockLedgers)
      .where(inArray(wmsTables.stockLedgers.skuId, part))
      .groupBy(wmsTables.stockLedgers.skuId);

    for (const { skuId, qty } of sums) {
      const vendor = vendorBySkuId.get(skuId) as string; // ponytail: move 의 skuId 로만 조회했다
      plan.stockByVendor.set(vendor, (plan.stockByVendor.get(vendor) ?? 0) + qty);
    }
  }

  return plan;
}

/** 없는 위탁 화주를 만들고 SKU 를 옮긴다. 읽은 뒤 화주가 바뀐 SKU 는 건너뛴다. 옮긴 수를 돌려준다. */
export async function applyConsignmentHolderPlan(tx: DbTx, plan: ConsignmentHolderPlan): Promise<number> {
  const holderIdByVendor = new Map<string, string>();

  for (const [vendor, id] of plan.holders) {
    if (id) {
      holderIdByVendor.set(vendor, id);
      continue;
    }

    const [created] = await tx
      .insert(wmsTables.holders)
      .values({ name: vendor, isOurAsset: false })
      .returning({ id: wmsTables.holders.id });

    holderIdByVendor.set(vendor, created.id);
  }

  let moved = 0;

  for (const m of plan.move) {
    const done = await tx
      .update(wmsTables.skus)
      .set({ holderId: holderIdByVendor.get(m.vendor) as string, updatedAt: new Date() }) // ponytail: 모든 업체가 위에서 채워졌다
      .where(and(eq(wmsTables.skus.id, m.skuId), eq(wmsTables.skus.holderId, m.fromHolderId)))
      .returning({ id: wmsTables.skus.id });

    moved += done.length;
  }

  return moved;
}

function printPlan(plan: ConsignmentHolderPlan): void {
  const moveByVendor = new Map<string, number>();

  for (const m of plan.move) {
    moveByVendor.set(m.vendor, (moveByVendor.get(m.vendor) ?? 0) + 1);
  }

  for (const [vendor, id] of plan.holders) {
    console.log(
      `🏷  ${vendor} — 화주 ${id ? '있음' : '새로 만듦'} · 옮길 SKU ${moveByVendor.get(vendor) ?? 0} · 그 재고 ${plan.stockByVendor.get(vendor) ?? 0}`,
    );
  }

  console.log(`   옮길 것 ${plan.move.length} · 이미 그 업체 ${plan.alreadyOk}`);
  console.log(
    `   다른 위탁 화주에 있음(안 옮김) ${plan.onOtherVendor.length} · core 에 SKU 없음 ${plan.notInCore.length}`,
  );

  for (const o of plan.onOtherVendor.slice(0, LIST_LIMIT)) {
    console.log(`   ⚠️  ${o.skuCode} — 파일 ${o.vendor}, 지금 ${o.currentVendor}`);
  }

  for (const code of plan.notInCore.slice(0, LIST_LIMIT)) {
    console.log(`   ❔ core 에 없는 옵션정보일련번호 ${code}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));

  if (!file) {
    console.error('사용법: bash scripts/sellmate/run.sh live assign-consignment-holders <업체 파일> [--apply]');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB). 라이브는 scripts/sellmate/run.sh');
    process.exit(1);
  }

  const { apply } = parseCliArgs(args, process.env);
  const rows = parseVendorRows(await readRows(file));
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });

  console.log(`📄 SKU ${rows.length}개 · 업체 ${new Set(rows.map((r) => r.vendor)).size}곳`);

  try {
    if (!apply) {
      await db.transaction(
        async (tx) => {
          printPlan(await readConsignmentHolderPlan(tx, rows));
          console.log('\n🧪 DRY-RUN — 아무것도 바꾸지 않았습니다. 반영하려면 --apply');
        },
        { accessMode: 'read only' },
      );

      return;
    }

    await db.transaction(async (tx) => {
      const plan = await readConsignmentHolderPlan(tx, rows);

      printPlan(plan);

      const moved = await applyConsignmentHolderPlan(tx, plan);

      console.log(`\n✅ 적용 — 옮김 ${moved} · 그 사이 바뀌어 건너뜀 ${plan.move.length - moved}`);
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
