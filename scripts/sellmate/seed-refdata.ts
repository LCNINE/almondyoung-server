/**
 * core 기준데이터 시드 (기본 홀더 / 창고 / 로케이션). idempotent.
 * import 는 기본 홀더 FK, sync 는 창고·로케이션 FK 가 필요하다.
 * seeding 의 FIXED_UUIDS 와 동일한 ID 를 사용 (autodeploy 시드와 충돌 없음).
 *
 *   bash scripts/sellmate/run.sh live seed-refdata apps/core/tmp/   (경로 인자 무시)
 *
 * 보통 autodeploy 의 db:seed:ref 가 이미 넣어두므로 live 에선 대개 불필요.
 * check 에서 ❌ 가 보일 때만 실행.
 */
import postgres from 'postgres';

const HOLDER = '019d0001-0000-7000-a000-000000000001';
const BUCHEON = '019d0001-0001-7000-a000-000000000001';
const CHINA = '019d0001-0002-7000-a000-000000000002';

const WAREHOUSES: [string, string, string][] = [
  [BUCHEON, '부천 물류창고', 'domestic'],
  [CHINA, '중국 물류창고', 'overseas'],
];
// [id, warehouseId, code, displayName, isSystem, systemRole]
const LOCATIONS: [string, string, string, string, boolean, string | null][] = [
  ['019d0002-0001-7000-a000-000000000001', BUCHEON, 'RECEIVING_DEFAULT', '입고기본존', true, 'inbound_default'],
  ['019d0002-0002-7000-a000-000000000002', BUCHEON, 'SHIPPING_DEFAULT', '출고기본존', false, null],
  ['019d0002-0003-7000-a000-000000000003', BUCHEON, 'DAMAGE_DEFAULT', '불량기본존', false, null],
  ['019d0002-0004-7000-a000-000000000004', BUCHEON, 'RETURN_DEFAULT', '반품기본존', true, 'return_default'],
  ['019d0002-0005-7000-a000-000000000005', CHINA, 'RECEIVING_DEFAULT', '입고기본존', true, 'inbound_default'],
  ['019d0002-0006-7000-a000-000000000006', CHINA, 'SHIPPING_DEFAULT', '출고기본존', false, null],
  ['019d0002-0007-7000-a000-000000000007', CHINA, 'DAMAGE_DEFAULT', '불량기본존', false, null],
  ['019d0002-0008-7000-a000-000000000008', CHINA, 'RETURN_DEFAULT', '반품기본존', true, 'return_default'],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql`INSERT INTO holders (id,name,is_our_asset) VALUES (${HOLDER},${'기본 보유자'},${true}) ON CONFLICT (id) DO NOTHING`;
    for (const w of WAREHOUSES) {
      await sql`INSERT INTO warehouses (id,name,type) VALUES (${w[0]},${w[1]},${w[2]}) ON CONFLICT (id) DO NOTHING`;
    }
    for (const l of LOCATIONS) {
      await sql`
        INSERT INTO locations (id,warehouse_id,code,location_type,rack_id,bin_identifier,display_name,is_expiry_separated,is_active,is_system,system_role)
        VALUES (${l[0]},${l[1]},${l[2]},${'zone'},${null},${null},${l[3]},${false},${true},${l[4]},${l[5]})
        ON CONFLICT (warehouse_id,code) DO NOTHING`;
    }
    const [c] = await sql`SELECT
      (SELECT count(*)::int FROM holders) AS holders,
      (SELECT count(*)::int FROM warehouses) AS warehouses,
      (SELECT count(*)::int FROM locations) AS locations`;
    console.log('✅ 시드 완료:', c);
  } catch (e) {
    console.error('실패:', (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
void main();
