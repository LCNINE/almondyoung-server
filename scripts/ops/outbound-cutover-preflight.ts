/**
 * 셀메이트 폐기 컷오버(#923) 사전 «판정». 읽기 전용이다 — 아무것도 고치지 않는다.
 *
 * 주문 수집 → 출고주문 → 계획 확정 → 운송장 → 배치 → 피킹·검수 → dispatch 사슬에서
 * 라이브 데이터·설정이 코드의 선행조건을 만족하는지 본다. 판정 조건은 코드에서 그대로 옮겼다
 * (각 검사 옆 주석의 파일이 정본이다 — 코드가 바뀌면 여기도 바꾼다).
 *
 * 판정자가 고치지 않는 이유는 `scripts/local/preflight-e2e.sh` 와 같다: 스스로 고치면 초록불이
 * 「원래 옳았다」의 증거가 아니게 된다. 그래서 모든 ✗ 는 무엇이 그걸 고치는지 함께 적는다.
 *
 * 사용 (터널: `npx sst tunnel --stage live` 가 떠 있어야 한다. AWS_PROFILE 은 export 하지 말 것):
 *   cd deployments/lcnine/services && npx sst shell --stage live -- npx tsx ../../../scripts/ops/outbound-cutover-preflight.ts
 *   cd deployments/lcnine/auth     && npx sst shell --stage live -- npx tsx ../../../scripts/ops/outbound-cutover-preflight.ts
 * services 에선 core·channel_adapter 를, auth 에선 user_service(역할 보유자·OAuth 클라이언트)를 본다.
 *
 * 로컬 검증: CORE_DATABASE_URL / CHANNEL_ADAPTER_DATABASE_URL / USER_SERVICE_DATABASE_URL 을 주면
 * sst Resource 대신 그 URL 을 쓴다.
 *
 * 종료 코드: ✗ 가 하나라도 있으면 1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

type Sql = postgres.Sql;

let failures = 0;
const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg: string, fix: string) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}\n      → ${fix}`);
};
const info = (msg: string) => console.log(`  \x1b[33m·\x1b[0m ${msg}`);
const section = (title: string) => console.log(`\n\x1b[1m${title}\x1b[0m`);
const table = (rows: readonly object[]) => {
  if (rows.length) console.table(rows);
  else info('(0행)');
};

interface DbResource {
  host: string;
  port: number;
  username: string;
  password: string;
}

// sst shell 밖(로컬 검증)에서도 돌도록 Resource 는 필요할 때만 읽는다.
// 링크되지 않은 리소스에 접근하면 sst 가 던지므로 null 로 바꾼다.
async function linkedResource(name: 'Db' | 'IdpDb'): Promise<DbResource | null> {
  if (!process.env[`SST_RESOURCE_${name}`]) return null;
  const { Resource } = await import('sst');
  return (Resource as unknown as Record<string, DbResource>)[name];
}

function connect(envUrl: string | undefined, resource: DbResource | null, database: string): Sql | null {
  if (envUrl) return postgres(envUrl, { max: 1, connect_timeout: 30, onnotice: () => undefined });
  if (!resource) return null;
  return postgres({
    host: process.env.DB_TUNNEL_HOST ?? resource.host,
    port: Number(process.env.DB_TUNNEL_PORT ?? resource.port),
    username: resource.username,
    password: resource.password,
    database,
    ssl: process.env.DB_TUNNEL_HOST ? false : 'require',
    max: 1,
    connect_timeout: 30,
    onnotice: () => undefined,
  });
}

// 모든 조회는 READ ONLY 트랜잭션 안에서만 돈다 — 실수로 쓰기 문이 섞여도 DB 가 거부한다.
async function readOnly(sql: Sql, fn: (tx: Sql) => Promise<void>): Promise<void> {
  await sql.begin('read only', (tx) => fn(tx as unknown as Sql));
}

const OPEN_SHIPMENT = `s.status in ('draft','planned')`;

async function checkCore(tx: Sql): Promise<void> {
  section('1. 창고 — 판매 창고에 discrete 피킹이 켜져 있나');
  // outbound-batch-orchestrator.service.ts: 창고 supported_picking_strategies 에 방식의 전략이 없으면
  // OUTBOUND_BATCH_METHOD_NOT_SUPPORTED(409). 단순출고는 individual(=discrete) 배치만 연다.
  const warehouses = await tx<{ name: string; is_sellable: boolean; supported_picking_strategies: string[] | null }[]>`
    select name, is_sellable, supported_picking_strategies from warehouses order by is_sellable desc, name`;
  table(warehouses);
  const sellable = warehouses.filter((w) => w.is_sellable);
  if (!sellable.length) bad('판매 창고가 0곳', 'admin-web 창고 화면에서 출고 창고의 판매를 켠다');
  for (const w of sellable) {
    const strategies = w.supported_picking_strategies ?? [];
    if (strategies.includes('discrete')) ok(`${w.name}: discrete 켜짐`);
    else bad(`${w.name}: discrete 꺼짐 → 배치 생성 409`, 'admin-web 창고 화면 «피킹 방식» 에서 개별피킹을 켠다 (#545)');
  }

  section('2. 배송 프로필 — 계획 확정(draft→planned)의 선행조건');
  // shipment-planning.service.ts assertPlanProfile: 스냅샷 3개가 비어 있지 않은 객체,
  // carrier_account_ref 공백 아님, supported_fulfillment_modes 가 in_house 포함.
  const profiles = await tx`
    select name,
      coalesce(jsonb_typeof(sender_snapshot) = 'object' and sender_snapshot <> '{}'::jsonb, false) as sender,
      coalesce(jsonb_typeof(origin_address_snapshot) = 'object' and origin_address_snapshot <> '{}'::jsonb, false) as origin,
      coalesce(jsonb_typeof(return_address_snapshot) = 'object' and return_address_snapshot <> '{}'::jsonb, false) as return,
      coalesce(btrim(carrier_account_ref) <> '', false) as carrier_account,
      coalesce('in_house' = any(supported_fulfillment_modes::text[]), false) as in_house
    from delivery_profiles order by name`;
  table(profiles);
  const complete = profiles.filter((p) => p.sender && p.origin && p.return && p.carrier_account && p.in_house);
  if (complete.length) ok(`완전한 배송 프로필 ${complete.length}개`);
  else
    bad(
      '완전한 배송 프로필이 없다 → 모든 상자가 SHIPMENT_PROFILE_INCOMPATIBLE/CONFIGURATION_INCOMPLETE 로 draft 에 갇힌다',
      '배송 프로필 생성 경로가 코드에 없다(API·화면 0). 생성 수단 + 한진 실계약번호(carrier_account_ref) 필요 — #923 §H',
    );

  // 열린 상자의 SKU 가 프로필을 갖고 있나. 한 상자의 SKU 는 전부 같은 프로필이어야 한다.
  const [skuCoverage] = await tx`
    select count(distinct sl.sku_id)::int as open_skus,
           count(distinct sl.sku_id) filter (where k.delivery_profile_id is null)::int as missing_profile,
           count(distinct sl.sku_id) filter (where k.stock_type = 'drop_shipped')::int as drop_shipped
    from shipments s
    join shipment_lines sl on sl.shipment_id = s.id
    join skus k on k.id = sl.sku_id
    where ${tx.unsafe(OPEN_SHIPMENT)}`;
  info(`열린 상자(draft·planned)의 SKU ${skuCoverage.open_skus}개`);
  if (skuCoverage.missing_profile === 0) ok('열린 상자 SKU 전부 delivery_profile_id 있음');
  else
    bad(
      `열린 상자 SKU 중 delivery_profile_id 없음 ${skuCoverage.missing_profile}개`,
      'SKU 에 배송 프로필을 연결한다 — 건별은 SKU 수정(PATCH /inventory/skus/:id)으로 되고, 일괄 백필은 보류 중 (#923 §H)',
    );
  const [mixedProfile] = await tx`
    select count(*)::int as n from (
      select s.id from shipments s
      join shipment_lines sl on sl.shipment_id = s.id
      join skus k on k.id = sl.sku_id
      where ${tx.unsafe(OPEN_SHIPMENT)}
      group by s.id having count(distinct k.delivery_profile_id) > 1) x`;
  if (mixedProfile.n) bad(`SKU 프로필이 섞인 열린 상자 ${mixedProfile.n}개`, '상자 분할 또는 SKU 프로필 통일');
  if (skuCoverage.drop_shipped) info(`열린 상자에 직배송 SKU ${skuCoverage.drop_shipped}개 — V2 계획 확정 불가(설계)`);

  section('3. 상자 상태·수취인');
  table(await tx`select status, count(*)::int from shipments group by 1 order by 2 desc`);
  // shipment-planning.service.ts assertRecipientComplete 의 5개 필드
  const [recipient] = await tx`
    select count(*)::int as n from shipments s
    where ${tx.unsafe(OPEN_SHIPMENT)} and exists (
      select 1 from unnest(array['recipientName','phone','postalCode','roadAddress','detailAddress']) k
      where coalesce(btrim(s.recipient_snapshot ->> k), '') = '')`;
  if (recipient.n === 0) ok('열린 상자의 수취인 5필드 전부 채워짐');
  else
    bad(
      `수취인 필드가 빈 열린 상자 ${recipient.n}개 → SHIPMENT_RECIPIENT_INCOMPLETE`,
      '수취인 정정(reviseRecipient). Medusa 주소의 address_2·phone 공백이 원인일 수 있다',
    );

  section('4. 예약 — 열린 상자는 라인별 확정 예약 = 수량이어야 한다');
  // shipment-reservation.service.ts / shipment-planning.service.ts assertFullyReserved
  const [reservation] = await tx`
    select count(distinct s.id)::int as open_shipments,
           count(distinct s.id) filter (where coalesce(r.confirmed, 0) <> sl.qty)::int as not_exact
    from shipments s
    join shipment_lines sl on sl.shipment_id = s.id
    left join (
      select shipment_line_id, sum(quantity)::int as confirmed from stock_reservations
      where status = 'confirmed' and shipment_line_id is not null group by 1) r on r.shipment_line_id = sl.id
    where ${tx.unsafe(OPEN_SHIPMENT)}`;
  info(
    `열린 상자 ${reservation.open_shipments}개 중 예약 불일치 ${reservation.not_exact}개 (재고 부족이면 정상일 수 있다)`,
  );

  // 유령 예약: 이미 끝난 출고주문(셀메이트로 나간 것)에 붙은 확정 예약. dispatch 를 안 거쳐 안 풀렸다.
  const ghosts = await tx`
    select fo.status as fo_status, count(*)::int as reservations, sum(r.quantity)::int as qty,
           count(distinct r.sku_id)::int as skus
    from stock_reservations r
    join shipment_lines sl on sl.id = r.shipment_line_id
    join fulfillment_order_items foi on foi.id = sl.fulfillment_order_item_id
    join fulfillment_orders fo on fo.id = foi.fulfillment_order_id
    where r.status = 'confirmed' and fo.status in ('shipped','completed','canceled')
    group by 1 order by 3 desc`;
  if (!ghosts.length) ok('끝난 출고주문에 붙은 확정 예약 0');
  else {
    table(ghosts);
    bad(
      '끝난 출고주문에 확정 예약이 남아 재고를 묶고 있다(유령 예약)',
      'ShipmentReservationService.releasePartial 로 해제 (#923 §E). ReservationLifecycleService 는 SHIPMENT_LINE 을 못 본다',
    );
  }
  const [negative] = await tx`select count(*)::int as n from stock_summary_view where available_qty < 0`;
  // 유령 예약이 0 인데도 음수면 이중 차감이다 — sync-stock 이 ON_HAND 를 「셀메이트 재고 − 미발송 주문 수」로
  // 맞추는데 core 도 같은 미발송 주문에 확정 예약을 들고 있다.
  if (negative.n)
    bad(
      `가용재고가 음수인 SKU·창고 ${negative.n}개`,
      ghosts.length
        ? '유령 예약 해제(close-shipped-shipments.ts) 후 다시 판정 (#923 §E)'
        : '유령 예약은 0 — sync-stock 과 core 예약의 이중 차감. 컷오버 때 물리 실사로 기준선 재설정 (#923 §E)',
    );
  else ok('가용재고 음수 0');

  section('5. 채널 식별자 — 없으면 dispatch 409 SHIPMENT_EVENT_IDENTITY_MISSING');
  // shipment-dispatch.service.ts: medusa·naver·coupang 라인은 판매주문 라인·channel_order_item_id·channel_order_id 필수
  const [identity] = await tx`
    select count(distinct s.id)::int as n from shipments s
    join shipment_lines sl on sl.shipment_id = s.id
    join fulfillment_order_items foi on foi.id = sl.fulfillment_order_item_id
    join fulfillment_orders fo on fo.id = foi.fulfillment_order_id
    join sales_orders so on so.id = fo.sales_order_id
    left join sales_order_lines sol on sol.id::text = foi.sales_order_line_id
    where ${tx.unsafe(OPEN_SHIPMENT)}
      and so.sales_channel in ('medusa','naver','coupang')
      and (sol.id is null or coalesce(btrim(sol.channel_order_item_id), '') = ''
           or coalesce(btrim(so.channel_order_id), '') = '')`;
  if (identity.n === 0) ok('열린 상자의 채널 식별자 전부 있음');
  else bad(`채널 식별자가 빠진 열린 상자 ${identity.n}개`, '원 주문에서 channel_order_item_id 백필 필요(이슈 미발행)');

  section('6. 출고주문 생성 대기열');
  table(
    await tx`select status, count(*)::int, max(updated_at) as last_updated
             from fulfillment_order_creation_backlogs group by 1 order by 2 desc`,
  );
  const [matching] = await tx`
    select count(*)::int as n from fulfillment_order_creation_backlogs where status = 'awaiting_matching'`;
  if (matching.n)
    bad(`매칭 대기 ${matching.n}건 — 출고주문으로 못 간다`, 'admin-web /order/matching 에서 SKU 매칭 (#923 §E)');
  else ok('매칭 대기 0');
  const failed = await tx`
    select coalesce(failure_reason, '(null)') as failure_reason, count(*)::int
    from fulfillment_order_creation_backlogs where status = 'failed' group by 1 order by 2 desc limit 10`;
  if (failed.length) {
    table(failed);
    info('failed 는 종결 없이 최대 15분 간격으로 영원히 재시도한다(혼합 SKU 등)');
  }

  section('7. 출고 깔때기 — 한 번이라도 돌았나');
  table(await tx`select status, count(*)::int from fulfillment_orders group by 1 order by 2 desc`);
  const funnel = await tx`
    select 'outbound_batches' as t, status::text, count(*)::int from outbound_batches group by 2
    union all select 'work_items', status::text, count(*)::int from outbound_batch_work_items group by 2
    union all select 'picking_plans', status::text, count(*)::int from picking_plans group by 2
    union all select 'waybills', status::text || '/' || source::text, count(*)::int from waybills group by 2
    union all select 'dispatch_attempts', status::text, count(*)::int from dispatch_attempts group by 2
    order by 1, 3 desc`;
  table(funnel);
  table(
    await tx`select transition_type, count(*)::int, max(occurred_at) as last_at
             from stock_events group by 1 order by 2 desc`,
  );
  const [journals] = await tx`select count(*)::int as n from stock_journals`;
  info(`stock_journals ${journals.n}행 (정식 원장 경로는 journal 을 먼저 꽂는다)`);
  const [sellmate] = await tx`
    select max(occurred_at) as last_at, count(*)::int as n from stock_events where reason = 'sellmate-sync'`;
  info(
    `셀메이트 재고 sync 마지막 실행 ${sellmate.last_at ?? '없음'} (누적 ${sellmate.n}건) — 컷오버 후엔 이 값이 멈춰야 한다`,
  );
  const [scriptShipped] = await tx`
    select count(*)::int as n from fulfillment_orders fo
    where fo.status = 'shipped' and not exists (
      select 1 from fulfillment_order_items foi
      join shipment_lines sl on sl.fulfillment_order_item_id = foi.id
      join dispatch_attempts da on da.shipment_id = sl.shipment_id
      where foi.fulfillment_order_id = fo.id)`;
  info(`dispatch 없이 shipped 인 출고주문 ${scriptShipped.n}건 = 셀메이트 스크립트가 마감한 것`);

  section('8. 권한 — fulfillment 스코프를 가진 역할');
  // platform/auth/fulfillment-scopes.ts. admin 은 fulfillment 스코프가 0 이라 배치·운송장 화면은
  // master 이거나 admin + logistics_* 여야 한다. 부팅 시 ensureRoleScopeMappings 가 목록 밖 매핑을 지운다.
  const scopes = await tx`
    select m.role_name, string_agg(s.key, ', ' order by s.key) as scopes
    from auth.role_scope_mapping m join auth.scopes s on s.id = m.scope_id
    where s.key like 'fulfillment.%' group by 1 order by 1`;
  table(scopes);
  if (
    scopes.some((r) => r.role_name === 'logistics_worker' && String(r.scopes).includes('fulfillment.warehouse.operate'))
  )
    ok('logistics_worker 에 fulfillment.warehouse.operate 매핑됨');
  else
    bad(
      'logistics_worker 에 fulfillment.warehouse.operate 가 없다',
      'core 재배포(ScopeBootstrapService 가 부팅 시 매핑을 upsert)',
    );

  section('9. 판매 채널');
  table(
    await tx`
      select c.site, c.is_active, count(l.id)::int as listings,
             count(l.id) filter (where l.is_active)::int as active_listings
      from sales_channels c left join channel_variant_listings l on l.sales_channel_id = c.id
      group by 1, 2 order by 1`,
  );
  info('naver·coupang 은 listings 가 0 이면 수집돼도 전 라인 격리된다');
}

async function checkChannelAdapter(tx: Sql): Promise<void> {
  section('10. 채널 수집 격리 (channel_adapter)');
  table(
    await tx`
      select channel, status, reason, count(*)::int, max(created_at) as last_at
      from order_collection_failures group by 1, 2, 3 order by 4 desc limit 20`,
  );
}

async function checkUserService(tx: Sql): Promise<void> {
  section('11. 역할 보유자 (user_service)');
  const holders = await tx`
    select r.name as role, count(distinct ur.user_id)::int as holders
    from roles r left join user_roles ur on ur.role_id = r.role_id
      and (ur.expires_at is null or ur.expires_at > now())
    where r.name in ('master','admin','logistics_worker','logistics_manager')
    group by 1 order by 1`;
  table(holders);
  const count = (name: string): number => Number(holders.find((h) => h.role === name)?.holders ?? 0);

  // 역할 «행» 자체가 없으면 부여할 수도 없다. 두 역할은 참조 시드(user-service.seed-step.ts)에만 있다.
  // 🔴 그 시드를 라이브에 그냥 돌리면 안 된다 — 고정 id 관리자 행이 없으면 `admin` 계정을 기본 비밀번호
  // (03-seed-orchestrator.ts 의 공개된 fallback)로 만들고 master 를 붙인다. 그래서 그 행이 있는지 같이 본다.
  const missingRoles = ['logistics_worker', 'logistics_manager'].filter((r) => !holders.some((h) => h.role === r));
  if (missingRoles.length) {
    const [seedAdmin] = await tx`
      select count(*)::int as n from users where id = '019d0004-2001-7000-a000-000000000001'`;
    bad(
      `역할 행이 없다: ${missingRoles.join(', ')} — 계정에 부여할 수조차 없다`,
      seedAdmin.n
        ? '참조 시드 db:seed:ref --deployment lcnine-auth (고정 관리자 행이 이미 있어 새 계정은 안 생긴다 — 그래도 --yes 없이 계획부터 볼 것)'
        : '🔴 db:seed:ref 를 그냥 돌리지 말 것 — 고정 관리자 행이 없어 기본 비밀번호 master 계정이 생긴다. ' +
            'ADMIN_INITIAL_PASSWORD 를 강한 값으로 주거나 roles 두 행만 손으로 넣는다',
    );
  }
  if (count('logistics_worker')) ok(`logistics_worker 보유자 ${count('logistics_worker')}명`);
  else
    bad('logistics_worker 보유자 0명 — 현장 작업자 계정이 없다', '작업자 계정에 logistics_worker 역할 부여 (#923 §C)');
  if (count('logistics_manager') || count('master'))
    ok('강제출고·handoff 가능한 역할(logistics_manager/master) 보유자 있음');
  else
    bad(
      'logistics_manager·master 보유자 0명 — 강제출고·결품 신고를 할 사람이 없다',
      '관리자 계정에 logistics_manager 부여',
    );

  section('12. warehouse-app OAuth 클라이언트');
  const clients = await tx`
    select client_id, client_type, is_active, redirect_uris from oauth_clients where client_id = 'warehouse-app'`;
  table(clients);
  if (clients.some((c) => c.is_active)) ok('warehouse-app 클라이언트 활성');
  else
    bad(
      'warehouse-app OAuth 클라이언트가 없거나 비활성 → 앱 로그인 불가',
      'user-service admin /admin/oauth-clients 로 등록',
    );
}

// 배포 IaC 에 한진·채널 자격증명이 배선돼 있는지. DB 가 아니라 저장소 파일이 정본이라 여기서 본다.
function checkWiring(): void {
  section('0. 배포 배선 (IaC)');
  const file = join(__dirname, '../../deployments/lcnine/services/infra/services.ts');
  const text = readFileSync(file, 'utf8');
  if (/HANJIN_/.test(text)) ok('services IaC 에 HANJIN_* 배선 있음');
  else
    bad(
      'Core 태스크에 HANJIN_* 가 배선돼 있지 않다 → 운송장 발급 409 WAYBILL_CARRIER_NOT_CONFIGURED',
      'deployments/lcnine/services/infra/services.ts Core env 에 한진 13개 키(시크릿) 배선 (#910)',
    );
  for (const key of ['NAVER_CLIENT_ID', 'COUPANG_ACCESS_KEY']) {
    if (new RegExp(`${key}:\\s*'1'`).test(text))
      bad(`${key} 가 자리표시 값 '1' 이다 — 이 채널 주문은 수집되지 않는다`, '실 자격증명을 시크릿으로 배선 (#923 §G)');
    else ok(`${key} 자리표시 값 아님`);
  }
}

async function main(): Promise<void> {
  checkWiring();

  const db = await linkedResource('Db');
  const core = connect(process.env.CORE_DATABASE_URL, db, 'core');
  const adapter = connect(process.env.CHANNEL_ADAPTER_DATABASE_URL, db, 'channel_adapter');
  const users = connect(process.env.USER_SERVICE_DATABASE_URL, await linkedResource('IdpDb'), 'user_service');
  if (!core && !users) {
    console.error('\nDB 에 닿을 수 없다 — sst shell 안에서 돌리거나 *_DATABASE_URL 을 준다 (파일 머리 주석)');
    process.exit(2);
  }
  try {
    if (core) await readOnly(core, checkCore);
    else info('\ncore 건너뜀 — deployments/lcnine/services 에서 sst shell 로 돌린다');
    if (adapter) await readOnly(adapter, checkChannelAdapter);
    if (users) await readOnly(users, checkUserService);
    else info('\nuser_service 건너뜀 — deployments/lcnine/auth 에서 sst shell 로 한 번 더 돌린다');
  } finally {
    await Promise.all([core, adapter, users].flatMap((s) => (s ? [s.end()] : [])));
  }

  console.log(failures ? `\n\x1b[31m✗ ${failures}건\x1b[0m` : '\n\x1b[32m✓ 전부 통과\x1b[0m');
  process.exit(failures ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
