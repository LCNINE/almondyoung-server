/**
 * 옛 아웃박스의 **존재 표지(marker)** 를 공용 `event.outbox_events` 로 옮긴다.
 * ADR-0029 §5-1, Task 6-C-4 의 선행 단계.
 *
 * ## 왜 필요한가
 *
 * 6-C-2·3 은 옛 아웃박스를 *읽는* 코드 3곳을 **두 테이블 다 읽기**로 처리하고 옛 갈래 제거를
 * 6-C-4 로 미뤘다. 그런데 그 3곳은 이벤트 큐를 읽는 게 아니라 **"이 사실이 이미 기록됐는가"를
 * 행의 존재로 판정**한다. 즉 옛 테이블을 DROP 하면 큐가 아니라 **판정 근거**가 사라진다.
 *
 * 드레인(미발행 행이 다 빠지는 것)과는 **시계가 다르다.** 드레인은 몇 분이면 끝나지만, 이
 * 표지들은 `published` 로 굳은 뒤에도 계속 읽힌다:
 *
 * | 표지 | 읽는 곳 | 잃으면 |
 * |---|---|---|
 * | `FulfillmentShipped` / `<foId>:fully-shipped` | `ShipmentDeliveryTrackingService.hasFullyShippedProjection` | 배포 이전에 출고된 FO 의 **배송완료 이벤트가 안 나간다**. 출고→배송 리드타임(며칠)만큼 노출 |
 * | `payment.intent.failed` / `aggregate_id` | `BillingChargeConsumer` FAILED 분기 | 커맨드 재전달 시 같은 실패가 **두 번** 발행된다 |
 * | `mandate.rejected` / `payload->>'idempotencyKey'` | `InvoiceCommandConsumer` | 같은 mandate.rejected 가 **두 번** 발행된다 |
 *
 * 그래서 순서가 이렇게 된다 — **이 스크립트 → 6-C-4 배포 → DROP**. 이 스크립트가 먼저 돌지
 * 않으면 6-C-4 가 배포되는 순간부터 DROP 전이라도 이미 옛 갈래를 안 읽으므로 구멍이 열린다.
 *
 * ## 무엇을 넣는가
 *
 * 표지일 뿐이므로 `status='PUBLISHED'` 로 넣는다 — 공용 디스패처의 acquire 술어
 * (`status='PENDING'`)에 걸리지 않아 **재발행되지 않는다**. `published_at` 은 옛 행의 값을
 * 그대로 옮기고, 없으면 `created_at` 으로 채운다.
 *
 * `unique(topic, event_type, idempotency_key)` 덕에 `ON CONFLICT DO NOTHING` 이 재실행을
 * 흡수한다 — 여러 번 돌려도 안전하다. 단 `idempotency_key` 가 NULL 인 갈래(wallet 의
 * `payment.intent.failed`)는 Postgres 가 NULL 을 서로 다르게 보므로 제약이 막지 못한다.
 * 그 갈래는 `NOT EXISTS` 로 직접 거른다.
 *
 * ## 사용법
 *
 * 접속은 `db:migrate` 등과 **같은 방식**이다 — `sst shell` 안에서 SST Resource 로 자격증명을
 * 얻고 앱별 논리 DB 이름을 붙인다. `sst shell` 밖에서 부르면 스스로 재진입하므로 그냥 부르면
 * 된다(`--stage` 필수). 터널이 필요하면 다른 터미널에서
 * `./scripts/sst-tunnel.sh deployments/lcnine/services live` 를 먼저 띄운다.
 *
 *   npm run events:marker-backfill -- --app wallet --stage live --deployment lcnine-services
 *   npm run events:marker-backfill -- --app wallet --stage live --deployment lcnine-services --execute
 *
 * **`--execute` 없이는 dry-run** 이다. `missing` 이 이번에 옮겨질 행 수다.
 *
 * 로컬/스크래치 DB 를 직접 겨냥하려면 `--url` 이나 `DATABASE_URL` 을 쓴다 — 그 경우
 * `sst shell` 재진입을 건너뛴다(검증 하네스가 이 경로를 쓴다).
 *
 * core 와 wallet 은 서로 다른 논리 DB 다. channel-adapter 는 대상이 아니다 — 옛 아웃박스를
 * 읽는 코드가 0곳이었다(6-C-3 실측).
 */

import postgres, { type Sql } from 'postgres';
import { ensureInsideSstShell } from '../seeding/lib/sst-shell-relaunch';

const FULFILLMENT_TOPIC = 'fulfillments.events.v1';
const FULFILLMENT_SHIPPED = 'FulfillmentShipped';
const PAYMENT_TOPIC = 'payments.events.v1';
const INTENT_FAILED = 'payment.intent.failed';
const MANDATE_REJECTED = 'mandate.rejected';

type AppName = 'core' | 'wallet';

interface MarkerReport {
  marker: string;
  legacyRows: number;
  alreadyPresent: number;
  missing: number;
  inserted: number | null;
}

function parseArgs(argv: string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equals = token.indexOf('=');
    if (equals >= 0) {
      parsed.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

async function legacyTableExists(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.outbox_events') IS NOT NULL AS exists
  `;
  return row.exists;
}

/**
 * core: `<foId>:fully-shipped` 표지.
 *
 * 읽는 쪽이 `topic + event_type + idempotency_key` 삼자로 찾으므로 그 셋을 그대로 옮긴다.
 * 옛 테이블의 `idempotency_key` 는 NOT NULL 이라 `ON CONFLICT` 가 전부 흡수한다.
 */
async function backfillCore(sql: Sql, execute: boolean): Promise<MarkerReport[]> {
  const [counts] = await sql<{ legacy: string; present: string }[]>`
    SELECT
      (SELECT count(*) FROM public.outbox_events
        WHERE topic = ${FULFILLMENT_TOPIC}
          AND event_type = ${FULFILLMENT_SHIPPED}
          AND idempotency_key LIKE '%:fully-shipped') AS legacy,
      (SELECT count(*) FROM public.outbox_events legacy
        WHERE legacy.topic = ${FULFILLMENT_TOPIC}
          AND legacy.event_type = ${FULFILLMENT_SHIPPED}
          AND legacy.idempotency_key LIKE '%:fully-shipped'
          AND EXISTS (
            SELECT 1 FROM event.outbox_events shared
            WHERE shared.topic = legacy.topic
              AND shared.event_type = legacy.event_type
              AND shared.idempotency_key = legacy.idempotency_key
          )) AS present
  `;
  const legacyRows = Number(counts.legacy);
  const alreadyPresent = Number(counts.present);

  let inserted: number | null = null;
  if (execute) {
    const rows = await sql`
      INSERT INTO event.outbox_events
        (topic, aggregate_type, aggregate_id, event_type, idempotency_key, partition_key,
         payload, status, created_at, published_at, next_attempt_at, retry_count)
      SELECT
        legacy.topic,
        legacy.aggregate_type,
        legacy.aggregate_id::text,
        legacy.event_type,
        legacy.idempotency_key,
        legacy.partition_key,
        legacy.payload::jsonb,
        'PUBLISHED',
        legacy.created_at,
        COALESCE(legacy.published_at, legacy.created_at),
        COALESCE(legacy.published_at, legacy.created_at),
        0
      FROM public.outbox_events legacy
      WHERE legacy.topic = ${FULFILLMENT_TOPIC}
        AND legacy.event_type = ${FULFILLMENT_SHIPPED}
        AND legacy.idempotency_key LIKE '%:fully-shipped'
      ON CONFLICT (topic, event_type, idempotency_key) DO NOTHING
      RETURNING id
    `;
    inserted = rows.length;
  }

  return [
    {
      marker: `${FULFILLMENT_TOPIC}/${FULFILLMENT_SHIPPED}/*:fully-shipped`,
      legacyRows,
      alreadyPresent,
      missing: legacyRows - alreadyPresent,
      inserted,
    },
  ];
}

/**
 * wallet: 두 갈래.
 *
 * 1. `payment.intent.failed` — 읽는 쪽이 `aggregate_id + event_type` 으로 찾는다.
 *    옛 테이블에 `topic`·`idempotency_key` 컬럼이 **없다** (wallet 로컬 판본이다). 그래서
 *    `topic` 은 계약값을 채우고 `idempotency_key` 는 NULL 로 둔다 — NULL 이면 unique 가
 *    막지 못하므로 `NOT EXISTS` 로 직접 중복을 거른다.
 * 2. `mandate.rejected` — 읽는 쪽이 옛 테이블에서는 `payload->>'idempotencyKey'` 로,
 *    새 테이블에서는 `idempotency_key` **컬럼**으로 찾는다. 옛 payload 는 도메인 payload 라
 *    그 JSON 경로에 값이 있다. 그 값을 컬럼으로 끌어올려 옮긴다.
 */
async function backfillWallet(sql: Sql, execute: boolean): Promise<MarkerReport[]> {
  const reports: MarkerReport[] = [];

  // ── 1. payment.intent.failed (aggregate_id 로 판정, 멱등키 없음)
  const [failedCounts] = await sql<{ legacy: string; present: string }[]>`
    SELECT
      (SELECT count(DISTINCT aggregate_id) FROM public.outbox_events
        WHERE event_type = ${INTENT_FAILED}) AS legacy,
      (SELECT count(DISTINCT legacy.aggregate_id) FROM public.outbox_events legacy
        WHERE legacy.event_type = ${INTENT_FAILED}
          AND EXISTS (
            SELECT 1 FROM event.outbox_events shared
            WHERE shared.aggregate_id = legacy.aggregate_id::text
              AND shared.event_type = legacy.event_type
          )) AS present
  `;
  let failedInserted: number | null = null;
  if (execute) {
    const rows = await sql`
      INSERT INTO event.outbox_events
        (topic, aggregate_type, aggregate_id, event_type, idempotency_key, partition_key,
         payload, status, created_at, published_at, next_attempt_at, retry_count)
      SELECT DISTINCT ON (legacy.aggregate_id)
        ${PAYMENT_TOPIC},
        legacy.aggregate_type,
        legacy.aggregate_id::text,
        legacy.event_type,
        NULL,
        legacy.partition_key,
        legacy.payload,
        'PUBLISHED',
        legacy.created_at,
        COALESCE(legacy.published_at, legacy.created_at),
        COALESCE(legacy.published_at, legacy.created_at),
        0
      FROM public.outbox_events legacy
      WHERE legacy.event_type = ${INTENT_FAILED}
        AND NOT EXISTS (
          SELECT 1 FROM event.outbox_events shared
          WHERE shared.aggregate_id = legacy.aggregate_id::text
            AND shared.event_type = legacy.event_type
        )
      ORDER BY legacy.aggregate_id, legacy.created_at ASC
      RETURNING id
    `;
    failedInserted = rows.length;
  }
  reports.push({
    marker: `${PAYMENT_TOPIC}/${INTENT_FAILED} (by aggregate_id)`,
    legacyRows: Number(failedCounts.legacy),
    alreadyPresent: Number(failedCounts.present),
    missing: Number(failedCounts.legacy) - Number(failedCounts.present),
    inserted: failedInserted,
  });

  // ── 2. mandate.rejected (옛 payload JSON → 새 idempotency_key 컬럼)
  const [mandateCounts] = await sql<{ legacy: string; present: string }[]>`
    SELECT
      (SELECT count(*) FROM public.outbox_events
        WHERE event_type = ${MANDATE_REJECTED}
          AND payload ->> 'idempotencyKey' IS NOT NULL) AS legacy,
      (SELECT count(*) FROM public.outbox_events legacy
        WHERE legacy.event_type = ${MANDATE_REJECTED}
          AND legacy.payload ->> 'idempotencyKey' IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM event.outbox_events shared
            WHERE shared.event_type = legacy.event_type
              AND shared.idempotency_key = legacy.payload ->> 'idempotencyKey'
          )) AS present
  `;
  let mandateInserted: number | null = null;
  if (execute) {
    const rows = await sql`
      INSERT INTO event.outbox_events
        (topic, aggregate_type, aggregate_id, event_type, idempotency_key, partition_key,
         payload, status, created_at, published_at, next_attempt_at, retry_count)
      SELECT DISTINCT ON (legacy.payload ->> 'idempotencyKey')
        ${PAYMENT_TOPIC},
        legacy.aggregate_type,
        legacy.aggregate_id::text,
        legacy.event_type,
        legacy.payload ->> 'idempotencyKey',
        legacy.partition_key,
        legacy.payload,
        'PUBLISHED',
        legacy.created_at,
        COALESCE(legacy.published_at, legacy.created_at),
        COALESCE(legacy.published_at, legacy.created_at),
        0
      FROM public.outbox_events legacy
      WHERE legacy.event_type = ${MANDATE_REJECTED}
        AND legacy.payload ->> 'idempotencyKey' IS NOT NULL
      ORDER BY legacy.payload ->> 'idempotencyKey', legacy.created_at ASC
      ON CONFLICT (topic, event_type, idempotency_key) DO NOTHING
      RETURNING id
    `;
    mandateInserted = rows.length;
  }
  reports.push({
    marker: `${PAYMENT_TOPIC}/${MANDATE_REJECTED} (by payload idempotencyKey)`,
    legacyRows: Number(mandateCounts.legacy),
    alreadyPresent: Number(mandateCounts.present),
    missing: Number(mandateCounts.legacy) - Number(mandateCounts.present),
    inserted: mandateInserted,
  });

  return reports;
}

/** `--app` → 논리 DB 이름. `scripts/seeding/lib/service-registry.ts` 와 같은 매핑이다. */
const APP_DATABASE: Record<AppName, string> = { core: 'core', wallet: 'wallet' };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const app = args.get('app');
  if (app !== 'core' && app !== 'wallet') {
    throw new Error('--app must be "core" or "wallet" (channel-adapter has no marker reads).');
  }
  const execute = args.get('execute') === true;

  // 명시 URL(로컬·스크래치)이 있으면 그대로 쓰고 sst 재진입을 건너뛴다. 없으면 `db:migrate`
  // 와 같은 경로로 간다 — `sst shell` 안에서 Resource 자격증명 + 앱별 논리 DB 이름.
  const explicitUrl = typeof args.get('url') === 'string' ? (args.get('url') as string) : process.env.DATABASE_URL;

  let databaseUrl: string;
  if (explicitUrl) {
    databaseUrl = explicitUrl;
  } else {
    const stage = typeof args.get('stage') === 'string' ? (args.get('stage') as string) : undefined;
    const deployment = typeof args.get('deployment') === 'string' ? (args.get('deployment') as string) : undefined;
    await ensureInsideSstShell({ stage, deployment });
    const { buildDatabaseUrl } = await import('../seeding/lib/db-connection');
    databaseUrl = buildDatabaseUrl(APP_DATABASE[app]);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    if (!(await legacyTableExists(sql))) {
      console.log(
        JSON.stringify(
          { app, status: 'skipped', reason: 'public.outbox_events does not exist — already dropped.' },
          null,
          2,
        ),
      );
      return;
    }

    const markers = await ((app as AppName) === 'core' ? backfillCore(sql, execute) : backfillWallet(sql, execute));

    console.log(
      JSON.stringify(
        {
          app,
          mode: execute ? 'execute' : 'dry-run',
          markers,
          message: execute
            ? 'Markers backfilled. 6-C-4 배포는 이제 안전하다 — DROP 은 배포 뒤에.'
            : 'Dry-run. `missing` 이 이번에 옮겨질 행 수다. --execute 를 붙여 실행한다.',
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
