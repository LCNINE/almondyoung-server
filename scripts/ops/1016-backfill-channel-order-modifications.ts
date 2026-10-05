/**
 * #1016 5번 행 백필(스펙 §9.2, R8) — PR 1·PR 2 배포 **뒤 한 번**.
 *
 * 격리(`collected_order_modification_not_accepted`·`quarantined`) 중 core 판매주문이 끝나지 않은 주문만
 * 즉시 끌어오기 입구에 `force: true` 로 보낸다. 실제 주소 변경은 반영되고, 오탐(우리 쪽 식별만 바뀜)은
 * core 가 기록 없이 버린다. 격리 행은 닫지 않는다(6번 행 몫).
 *
 * 이 스크립트는 DB 에 쓰지 않는다 — 두 연결 모두 읽기 전용이다. 쓰기는 입구(channel-adapter)가 한다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   # 대상만 센다 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-backfill-channel-order-modifications.ts
 *   # 실제 실행
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-backfill-channel-order-modifications.ts \
 *     --apply --base-url https://channel-adapter.almondyoung.com
 */
import postgres from 'postgres';
import { Resource } from 'sst';
import {
  CoreSalesOrderStatus,
  QuarantinedModification,
  countByReason,
  selectBackfillTargets,
} from './1016-backfill-targets';

const APPLY = process.argv.includes('--apply');
const BASE_URL = argValue('--base-url');
const PAUSE_MS = 300;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// `Resource` 의 타입 선언에는 `Db`·시크릿이 없다(SST 가 실행 시점에 채운다). 기존 ops 스크립트
// (647-close-already-collected-quarantines.ts)와 같은 이유로 캐스팅한다.
const linked = Resource as unknown as {
  Db: { host: string; port: number; username: string; password: string };
  ChannelAdapterInternalKey?: { value: string };
};

function connect(database: string) {
  return postgres({
    host: linked.Db.host,
    port: linked.Db.port,
    username: linked.Db.username,
    password: linked.Db.password,
    database,
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
    // 이 스크립트는 읽기만 한다 — 실수로 쓰는 문장이 들어와도 서버가 거절하게 한다.
    connection: { default_transaction_read_only: true },
  });
}

async function loadQuarantined(): Promise<QuarantinedModification[]> {
  const sql = connect('channel_adapter');
  try {
    return await sql<QuarantinedModification[]>`
      SELECT channel, external_order_id AS "externalOrderId"
      FROM order_collection_failures
      WHERE reason = 'collected_order_modification_not_accepted' AND status = 'quarantined'
      ORDER BY created_at`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// 대상 목록에 주문일을 함께 찍기 위한 행 — 선별 순수 함수는 CoreSalesOrderStatus 만 본다.
type CoreSalesOrderRow = CoreSalesOrderStatus & { orderDate: Date | null };

async function loadSalesOrders(rows: QuarantinedModification[]): Promise<CoreSalesOrderRow[]> {
  if (rows.length === 0) return [];
  const sql = connect('core');
  try {
    return await sql<CoreSalesOrderRow[]>`
      SELECT sales_channel AS "salesChannel", channel_order_id AS "channelOrderId", status::text AS status,
             order_date AS "orderDate"
      FROM sales_orders
      WHERE channel_order_id = ANY(${rows.map((row) => row.externalOrderId)})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function syncOne(baseUrl: string, key: string, row: QuarantinedModification): Promise<string> {
  const url = `${baseUrl}/adapter/orders/${encodeURIComponent(row.channel)}/${encodeURIComponent(row.externalOrderId)}/sync`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ force: true }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const parsed: unknown = JSON.parse(text);
  const outcome = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'outcome') : undefined;
  if (typeof outcome !== 'string') throw new Error(`응답에 outcome 이 없다: ${text.slice(0, 300)}`);
  return outcome;
}

async function main(): Promise<void> {
  console.log(
    `모드: ${APPLY ? '실행 (--apply)' : '대상만 센다 — 실행하려면 --apply --base-url <channel-adapter URL>'}\n`,
  );

  // 실행 모드의 전제는 DB 를 읽기 전에 확인한다 — 읽고 나서 죽으면 헛수고다.
  const key = linked.ChannelAdapterInternalKey?.value ?? process.env.CHANNEL_ADAPTER_INTERNAL_KEY;
  if (APPLY) {
    if (!BASE_URL) throw new Error('--apply 에는 --base-url 이 필요하다 (예: https://channel-adapter.almondyoung.com)');
    if (!key)
      throw new Error(
        'ChannelAdapterInternalKey 를 읽지 못했다 — sst shell 안에서 돌리거나 CHANNEL_ADAPTER_INTERNAL_KEY 를 넘긴다',
      );
  }

  const quarantined = await loadQuarantined();
  const salesOrders = await loadSalesOrders(quarantined);
  const { targets, skipped } = selectBackfillTargets(quarantined, salesOrders);
  console.log(`격리 ${quarantined.length}건 → 대상 ${targets.length}건, 제외 ${skipped.length}건`);
  console.table(countByReason(skipped));
  // 무엇을 승인했는지 확인할 수 있게 대상 행을 전부 찍는다. 오래된 pending 은 셀메이트가 이미 출고했는데
  // 표시 스크립트가 아직 안 돈 주문일 수 있으니, 운영자가 눈으로 볼 수 있게 core 상태와 주문일을 붙인다.
  const orderByKey = new Map(salesOrders.map((order) => [`${order.salesChannel}:${order.channelOrderId}`, order]));
  for (const row of targets) {
    const order = orderByKey.get(`${row.channel}:${row.externalOrderId}`);
    const date = order?.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '-';
    console.log(`  ${row.channel}  ${row.externalOrderId}  ${order?.status ?? '-'}  ${date}`);
  }

  if (!APPLY || !BASE_URL || !key) return;

  const outcomes: Record<string, number> = {};
  let failed = 0;
  for (const row of targets) {
    try {
      const outcome = await syncOne(BASE_URL.replace(/\/+$/, ''), key, row);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      console.log(`  ✓ ${row.externalOrderId}  ${outcome}`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${row.externalOrderId}  ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  console.log('\n결과');
  console.table(outcomes);
  if (failed > 0) {
    console.log(
      `실패 ${failed}건 — 같은 명령을 다시 돌려도 안전하다 — 이미 반영된 변경은 no-op 으로 돌아오고, 계속 pending 인 주문은 새 pending 행이 옛 행을 대체한다.`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
