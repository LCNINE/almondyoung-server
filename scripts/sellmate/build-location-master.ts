/**
 * 셀메이트 선반 위치(sku_shelf_positions) → 판매 창고 로케이션 마스터 (#1235).
 *
 * 창고 선반 칸마다 붙은 자석 라벨의 바코드 값 = 셀메이트 위치 코드라서, 그 코드로 standard 로케이션을 만들면
 * 적치 화면이 자석을 스캔해 목적지로 잡는다. 바코드 출력은 없다.
 *
 * - 기본은 dry-run: 한 트랜잭션에서 실제로 만들어 보고 보고서를 찍은 뒤 되돌린다(그래서 수치가 apply 와 같다).
 * - `--apply` 면 커밋한다.
 * - 늘리기만 한다. 아무것도 지우지 않는다. 셀메이트 위치가 바뀌면 다시 돌리면 된다(멱등).
 * - 쓰는 테이블은 location_columns · location_racks · locations 셋뿐이다.
 * - 칸은 core 의 `PUT /racks/:rackId` 와 같은 함수(syncRackBins)로 만든다 — API 로 늘린 결과와 어긋나지 않는다.
 * - 원문 목록(예외 텍스트 등)은 콘솔에만 찍는다. 창고·거래처 이름이 섞일 수 있어 파일로 남기지 않는다.
 *
 * ── 실행 ─────────────────────────────────────────────────────────────────────
 *   bash scripts/sellmate/run.sh live build-location-master                      # dry-run
 *   bash scripts/sellmate/run.sh live build-location-master --apply              # 반영
 *   … build-location-master --warehouse-id <uuid>                                 # 판매 창고가 하나가 아닐 때
 *   DATABASE_URL=postgres://…/core npx tsx scripts/sellmate/build-location-master.ts   # 로컬
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { autoBinIdentifier, rackBinLocationCode } from '../../apps/core/src/modules/inventory/core/location-code';
import { readShelfCode } from '../../apps/core/src/modules/inventory/core/shelf-code-reading';
import { syncRackBins } from '../../apps/core/src/modules/inventory/core/services/rack-bin-sync';
import { LocationMasterPlan, RackPlan, planLocationMaster } from './location-master-plan';

export type ApplyReport = {
  columnsCreated: string[];
  racksCreated: string[];
  racksExtended: { rack: string; from: number; to: number }[];
  binsCreated: number;
  conflicts: { code: string; reason: string }[];
};

const rackLabel = (r: RackPlan) => `${r.column}-${String(r.rackNumber).padStart(2, '0')}`;

/** 이 랙이 갖게 될 칸 코드 — 숫자 칸 1..end 와 커스텀 칸. */
function desiredCodes(r: RackPlan, end: number): string[] {
  const codes: string[] = [];
  for (let n = 1; n <= end; n++) codes.push(rackBinLocationCode(r.column, r.rackNumber, autoBinIdentifier(n)));
  for (const bin of r.customBins) codes.push(rackBinLocationCode(r.column, r.rackNumber, bin));
  return codes;
}

export async function applyLocationMaster(tx: DbTx, warehouseId: string, plan: LocationMasterPlan): Promise<ApplyReport> {
  const report: ApplyReport = { columnsCreated: [], racksCreated: [], racksExtended: [], binsCreated: 0, conflicts: [] };
  const columnIds = new Map<string, string>();

  for (const r of plan.racks) {
    const label = rackLabel(r);
    const [existingColumn] = await tx
      .select({ id: wmsTables.locationColumns.id })
      .from(wmsTables.locationColumns)
      .where(and(eq(wmsTables.locationColumns.warehouseId, warehouseId), eq(wmsTables.locationColumns.columnName, r.column)));
    const [rack] = existingColumn
      ? await tx
          .select()
          .from(wmsTables.locationRacks)
          .where(and(eq(wmsTables.locationRacks.columnId, existingColumn.id), eq(wmsTables.locationRacks.rackNumber, r.rackNumber)))
      : [];

    if (rack && !rack.autoGenerateBins && r.binEnd !== null) {
      report.conflicts.push({ code: label, reason: '수동 랙(자동 생성 꺼짐) — 칸은 사람이 API 로 더한다' });
      continue;
    }

    // 다른 랙이나 zone 이 같은 코드를 쓰고 있으면 이 랙은 건너뛴다(unique (warehouse_id, code)).
    const end = Math.max(rack?.defaultBinEnd ?? 0, r.binEnd ?? 0);
    const taken = await tx
      .select({ code: wmsTables.locations.code, rackId: wmsTables.locations.rackId, type: wmsTables.locations.locationType })
      .from(wmsTables.locations)
      .where(and(eq(wmsTables.locations.warehouseId, warehouseId), inArray(wmsTables.locations.code, desiredCodes(r, end))));
    const foreign = taken.filter((t) => !rack || t.rackId !== rack.id);
    if (foreign.length > 0) {
      for (const t of foreign) {
        report.conflicts.push({ code: t.code, reason: t.rackId ? '다른 랙의 칸이 같은 코드' : `같은 코드의 ${t.type} 로케이션` });
      }
      continue;
    }

    let columnId = existingColumn?.id ?? columnIds.get(r.column);
    if (!columnId) {
      const [created] = await tx
        .insert(wmsTables.locationColumns)
        .values({ warehouseId, columnName: r.column })
        .returning({ id: wmsTables.locationColumns.id });
      columnId = created.id;
      report.columnsCreated.push(r.column);
    }
    columnIds.set(r.column, columnId);

    let rackId: string;
    if (!rack) {
      const [created] = await tx
        .insert(wmsTables.locationRacks)
        .values({
          columnId,
          rackNumber: r.rackNumber,
          defaultBinStart: 1,
          defaultBinEnd: r.binEnd ?? 1,
          autoGenerateBins: r.binEnd !== null,
        })
        .returning({ id: wmsTables.locationRacks.id });
      rackId = created.id;
      report.racksCreated.push(label);
    } else {
      rackId = rack.id;
      if (r.binEnd !== null && rack.defaultBinEnd < r.binEnd) {
        await tx
          .update(wmsTables.locationRacks)
          .set({ defaultBinEnd: r.binEnd, updatedAt: new Date() })
          .where(eq(wmsTables.locationRacks.id, rack.id));
        report.racksExtended.push({ rack: label, from: rack.defaultBinEnd, to: r.binEnd });
      }
    }

    const changes = await syncRackBins(tx, rackId);
    if (changes.deleted.length > 0) {
      // 스크립트는 끝 번호를 줄이지 않으므로 지울 칸이 생길 수 없다. 생겼다면 전제가 깨진 것이라 전부 되돌린다.
      throw new Error(`${label}: 스크립트가 칸을 지우려 했다 (${changes.deleted.join(', ')}) — 중단`);
    }
    report.binsCreated += changes.created.length;

    for (const bin of r.customBins) {
      const code = rackBinLocationCode(r.column, r.rackNumber, bin);
      if (taken.some((t) => t.code === code)) continue;
      await tx.insert(wmsTables.locations).values({
        warehouseId,
        code,
        locationType: 'standard',
        rackId,
        binIdentifier: bin,
        displayName: code,
        isActive: true,
      });
      report.binsCreated += 1;
    }
  }
  return report;
}

class DryRunRollback extends Error {}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB). 라이브는 scripts/sellmate/run.sh live build-location-master');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });
  try {
    const sellable = await db
      .select({ id: wmsTables.warehouses.id, name: wmsTables.warehouses.name })
      .from(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.isSellable, true));
    const warehouseId = flagValue('--warehouse-id') ?? (sellable.length === 1 ? sellable[0].id : undefined);
    if (!warehouseId) {
      console.error(`판매 창고가 ${sellable.length}개입니다. --warehouse-id 로 고르세요:`);
      for (const w of sellable) console.error(`  ${w.id}  ${w.name}`);
      process.exit(1);
    }

    const rows = await db
      .select({ positionCode: wmsTables.skuShelfPositions.positionCode, skuCount: count() })
      .from(wmsTables.skuShelfPositions)
      .groupBy(wmsTables.skuShelfPositions.positionCode);
    const plan = planLocationMaster(rows);

    console.log(`📄 선반 코드 ${rows.length}개 → 열 ${plan.columns.length} · 랙 ${plan.racks.length}`);
    for (const m of plan.missingRackNumbers) console.log(`   데이터에 없는 랙 번호 ${m.column}: ${m.rackNumbers.join(', ')}`);
    console.log(`\n✏️  고쳐 읽음 ${plan.fixed.length}개`);
    for (const f of plan.fixed) console.log(`   ${f.raw} → ${f.code} (${f.rule}, SKU ${f.skuCount})`);
    console.log(`\n🔖 커스텀 칸 ${plan.customBins.length}개`);
    for (const c of plan.customBins) console.log(`   ${c.code} (SKU ${c.skuCount})`);
    console.log(`\n❓ 사람이 정할 예외 ${plan.exceptions.length}개 — 만들지 않는다`);
    for (const e of plan.exceptions) console.log(`   ${JSON.stringify(e.raw)} (SKU ${e.skuCount})`);

    await db
      .transaction(async (trx) => {
        const tx = trx as unknown as DbTx;
        const report = await applyLocationMaster(tx, warehouseId, plan);
        console.log(`\n${apply ? '✅ 적용' : '🧪 DRY-RUN (되돌림)'}`);
        console.log(`   열 생성 ${report.columnsCreated.length} · 랙 생성 ${report.racksCreated.length} · 칸 생성 ${report.binsCreated}`);
        for (const e of report.racksExtended) console.log(`   랙 늘림 ${e.rack}: ${e.from} → ${e.to}`);
        for (const c of report.conflicts) console.log(`   ⚠️  충돌 ${c.code}: ${c.reason}`);

        const codes = new Set(
          (
            await tx
              .select({ code: wmsTables.locations.code })
              .from(wmsTables.locations)
              .where(eq(wmsTables.locations.warehouseId, warehouseId))
          ).map((l) => l.code),
        );
        const total = rows.reduce((s, r) => s + r.skuCount, 0);
        const linked = rows.reduce((s, r) => {
          const reading = readShelfCode(r.positionCode);
          return reading.kind !== 'exception' && codes.has(reading.code) ? s + r.skuCount : s;
        }, 0);
        const pct = total === 0 ? 0 : Math.round((linked / total) * 1000) / 10;
        console.log(`\n🔗 선반 위치가 로케이션으로 이어지는 SKU ${linked}/${total} (${pct}%)`);
        if (!apply) throw new DryRunRollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof DryRunRollback)) throw err;
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
