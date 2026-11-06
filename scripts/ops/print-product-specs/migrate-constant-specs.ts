import postgres, { Sql } from 'postgres';
import { WOWPRESS_PRODUCTS } from '../../../apps/core/src/modules/print-order/wowpress/wowpress-products';
import { createServiceConnection } from '../../seeding/lib/db-connection';
import { resolveRegistry, sstShellStage } from '../../seeding/lib/tenant-registry';

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);

  if (i < 0) return undefined;

  const value = args[i + 1];

  if (value === undefined || value.startsWith('--')) throw new Error(`${name} 에 값이 없다`);

  return value;
}

// 상수 한 줄을 print_product_specs 컬럼 값으로 편다
function constantRows() {
  return Object.entries(WOWPRESS_PRODUCTS).map(([variantId, spec]) => ({
    variantId,
    prodno: spec.prodno,
    jobpresetno: spec.jobpresetno,
    prsjob: JSON.stringify(spec.prsjob),
    awkjob: JSON.stringify(spec.awkjob),
    qtyPerUnit: spec.qtyPerUnit,
    fileFormat: spec.file.format,
    fileDpi: spec.file.dpi,
    designProductId: spec.design.productId,
    designWidthMm: spec.design.widthMm,
    designHeightMm: spec.design.heightMm,
    confirmed: spec.confirmed,
  }));
}

async function migrate(sql: Sql, dryRun: boolean): Promise<number> {
  const rows = constantRows();

  if (dryRun) {
    const existing = await sql<{ variant_id: string }[]>`
      SELECT variant_id FROM print_product_specs WHERE variant_id = ANY(${rows.map((r) => r.variantId)}::uuid[])
    `;
    const have = new Set(existing.map((r) => r.variant_id));

    return rows.filter((r) => !have.has(r.variantId)).length;
  }

  let inserted = 0;

  for (const r of rows) {
    const created = await sql`
      INSERT INTO print_product_specs (
        variant_id, prodno, jobpresetno, prsjob, awkjob, qty_per_unit, file_format, file_dpi,
        design_product_id, design_width_mm, design_height_mm, confirmed
      ) VALUES (
        ${r.variantId}, ${r.prodno}, ${r.jobpresetno}, ${r.prsjob}::jsonb, ${r.awkjob}::jsonb, ${r.qtyPerUnit},
        ${r.fileFormat}, ${r.fileDpi}, ${r.designProductId}, ${r.designWidthMm}, ${r.designHeightMm}, ${r.confirmed}
      )
      ON CONFLICT (variant_id) DO NOTHING
      RETURNING variant_id
    `;
    inserted += created.length;
  }

  return inserted;
}

// local 은 DATABASE_URL, 그 밖의 stage 는 sst shell 의 테넌트 core DB 로 붙는다
function openConnections(stage: string, tenant: string | undefined): { label: string; sql: Sql }[] {
  if (stage === 'local') {
    const url = process.env.DATABASE_URL;

    if (!url) throw new Error('local 은 DATABASE_URL 이 필요하다 (dotenv -e apps/core/.env -- ...)');

    return [{ label: 'local', sql: postgres(url, { max: 1, connect_timeout: 10 }) }];
  }

  // 요청한 stage 와 sst shell 의 stage 가 다르면 엉뚱한 stage 에 쓰게 되므로 거절한다
  const shellStage = sstShellStage(process.env);

  if (shellStage !== stage) {
    throw new Error(`--stage ${stage} 가 sst shell 의 stage(${shellStage ?? '없음'})와 다르다`);
  }

  return resolveRegistry({ deployment: 'lcnine-services', tenant })
    .filter((svc) => svc.name === 'core')
    .map((svc) => ({ label: svc.database, sql: createServiceConnection(svc.database, { max: 1, connect_timeout: 30 }) }));
}

async function main() {
  const args = process.argv.slice(2);
  const stage = argValue(args, '--stage');
  const dryRun = args.includes('--dry-run');

  if (!stage) throw new Error('--stage <stage> 가 필요하다');

  for (const { label, sql } of openConnections(stage, argValue(args, '--tenant'))) {
    try {
      const count = await migrate(sql, dryRun);

      console.log(dryRun ? `[${label}] would insert ${count}` : `[${label}] inserted ${count}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'migrate failed');
  process.exitCode = 1;
});
