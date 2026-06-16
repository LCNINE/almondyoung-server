#!/usr/bin/env node
/**
 * Core DB에서 FO를 조회해 sellmate-fo-YYYYMMDD.json 형식으로 저장
 *
 * 실행:
 *   DATABASE_URL=<core-db-url> node src/scripts/fetch-fo-sellmate.js
 *   또는 package.json의 fo:fetch / fo:export 사용
 *
 * 환경변수:
 *   DATABASE_URL  - Core PostgreSQL 연결 문자열 (필수)
 *   FROM_DATE     - 조회 시작일 KST (예: "2026-06-16")  기본값: 오늘
 *   TO_DATE       - 조회 종료일 KST                    기본값: 오늘
 *   STATUS        - FO 상태 콤마 구분                   기본값: "created"
 *   OUTPUT        - 출력 JSON 경로
 */

const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function todayKST() {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function toDateTagKST(dateStr) {
  return dateStr.replace(/-/g, '');
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // sst shell 안에서 실행 시: SST_RESOURCE_Db JSON 자동 주입
  const sstResource = process.env.SST_RESOURCE_Db;
  if (sstResource) {
    const { host, port, username, password } = JSON.parse(sstResource);
    return `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/core?sslmode=require`;
  }

  console.error(
    '오류: DATABASE_URL 환경변수 또는 sst shell 환경(SST_RESOURCE_Db)이 필요합니다.\n' +
    '  live DB: npx sst shell --stage live --deployment lcnine-services -- node apps/medusa/src/scripts/fetch-fo-sellmate.js',
  );
  process.exit(1);
}

async function main() {
  const dbUrl = resolveDatabaseUrl();

  const today = todayKST();
  const fromDate = process.env.FROM_DATE ?? today;
  const toDate = process.env.TO_DATE ?? today;
  const statuses = (process.env.STATUS ?? 'created').split(',').map((s) => s.trim());

  const fromISO = `${fromDate}T00:00:00+09:00`;
  const toISO = `${toDate}T23:59:59+09:00`;

  console.log(`[fo-fetch] 기간: ${fromDate} ~ ${toDate} (KST), 상태: ${statuses.join(', ')}`);

  const sql = postgres(dbUrl, { max: 1 });

  try {
    const rows = await sql`
      SELECT
        fo.id          AS fo_id,
        fo.created_at,
        fo.shipping_address,
        fo.status,
        so.channel_order_id,
        foi.id         AS foi_id,
        foi.qty,
        foi.sales_order_line_id,
        sol.unit_price,
        s.name         AS sku_name,
        s.code         AS sku_code
      FROM fulfillment_orders fo
      LEFT JOIN sales_orders so
        ON so.id = fo.sales_order_id
      JOIN fulfillment_order_items foi
        ON foi.fulfillment_order_id = fo.id
      JOIN skus s
        ON s.id = foi.sku_id
      LEFT JOIN sales_order_lines sol
        ON sol.id::text = foi.sales_order_line_id
      WHERE fo.status = ANY(${statuses})
        AND fo.created_at >= ${fromISO}::timestamptz
        AND fo.created_at <= ${toISO}::timestamptz
      ORDER BY fo.created_at ASC, foi.created_at ASC
    `;

    // FO 단위로 그룹화
    const foMap = new Map();
    for (const row of rows) {
      if (!foMap.has(row.fo_id)) {
        foMap.set(row.fo_id, {
          id: row.fo_id,
          displayId: row.channel_order_id ?? row.fo_id,
          createdAt: row.created_at,
          status: row.status,
          shippingAddress: row.shipping_address ?? {},
          items: [],
        });
      }
      foMap.get(row.fo_id).items.push({
        skuName: row.sku_name ?? '',
        skuCode: row.sku_code ?? '',
        unitPrice: row.unit_price ?? 0,
        quantity: row.qty,
      });
    }

    const result = [...foMap.values()];
    const totalItems = rows.length;
    console.log(`[fo-fetch] ${result.length}건 FO (아이템 ${totalItems}개 라인) 조회 완료`);

    const dateTag = toDateTagKST(fromDate);
    const outputPath = process.env.OUTPUT ?? path.join(process.cwd(), `sellmate-fo-${dateTag}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[fo-fetch] → ${outputPath}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
