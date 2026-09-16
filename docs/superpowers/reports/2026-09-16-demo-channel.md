# Demo channel ingestion report

## Environment and authorization

The channel adapter enables the demo surface only when all three values match exactly:

```text
APP_STAGE=demo
DEMO_CONSOLE_ENABLED=true
EXTERNAL_INTEGRATIONS_MODE=mock
```

Any partial or contradictory demo configuration fails environment validation. In this mode the module does not
register the Naver, Coupang, Medusa, membership, user, product projection, revalidation, failed-inbox revival,
coupon reconciliation, or periodic external order collection providers. It retains the shipment event consumer,
but `ShipmentDispatchInboxWorker` records a mock acknowledgement before resolving channel capabilities or an
external adapter. Demo routes remain behind the application-wide JWT and admin-realm guards and an additional
server-side `DemoModeGuard`.

## HTTP contract

The channel adapter has no response-envelope interceptor, so these are the direct JSON response bodies.

### `POST /demo/runs`

Request:

```ts
{
  requestId: string; // UUID, idempotency key
  scenario: 'happy_path' | 'inventory_shortage';
  count: number; // integer, 1..50
  variantId?: string; // UUID from demo-logistics-v1
  quantity?: number; // integer, 1..100
}
```

Response: HTTP 202 with the run detail DTO below. `happy_path` defaults to high-stock variant
`019f1003-0030-7000-a000-000000000030` and quantity `1`; its fixture stock of 70 covers the maximum 50-order
default run. `inventory_shortage` defaults to low-stock variant `019f1003-0001-7000-a000-000000000001` and
quantity `10`; its fixture stock is 2. Explicit variant and quantity values override the preset and may change the
inventory outcome. Defaults and the fixture version are normalized before hashing, so a replay may send either the
original omitted values or the explicit values returned by the first response.

Reposting the same `requestId` and normalized input returns the same durable run and resumes only unfinished or
failed items. A concurrent or later request with the same `requestId` and different normalized input returns HTTP
409. Item identities, external order IDs, sales order correlation IDs, and typed event idempotency keys are stable
across retries.

```ts
type DemoRunDetail = {
  id: string;
  requestId: string;
  fixtureVersion: 'demo-logistics-v1';
  scenario: 'happy_path' | 'inventory_shortage';
  status: 'processing' | 'completed' | 'partial_failure' | 'failed';
  count: number;
  variantId: string;
  quantity: number;
  summary: { requested: number; enqueued: number; failed: number };
  items: Array<{
    id: string;
    sequence: number;
    externalOrderId: string;
    orderId: string;
    status: 'pending' | 'processing' | 'enqueued' | 'failed';
    attempts: number;
    error: string | null;
    enqueuedAt: string | null; // ISO-8601
  }>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

`completed` means every requested `OrderCreated` was durably accepted by the existing channel mapping plus typed
transactional outbox path. It does not mean Core has consumed the event or created a fulfillment order. The
returned `orderId` is the cross-service order correlation value; Core owns its generated `salesOrderId`, so that ID
must be resolved from Core after consumption.

### `GET /demo/runs?limit=20`

`limit` is optional and accepts integers from 1 through 100. The response is:

```ts
{
  items: Array<Omit<DemoRunDetail, 'items'>>;
  total: number;
}
```

### `GET /demo/runs/:id`

Returns `DemoRunDetail`, HTTP 400 for a malformed UUID, or HTTP 404 for an unknown run.

### `GET /demo/capabilities`

```ts
{
  enabled: true;
  stage: 'demo';
  externalIntegrationsMode: 'mock';
  fixtureVersion: 'demo-logistics-v1';
  salesChannel: 'medusa';
  scenarios: ['happy_path', 'inventory_shortage'];
  maxCount: 50;
}
```

### `GET /demo/dispatch-outcomes?limit=20`

`limit` is optional and accepts integers from 1 through 100. It exposes the newest persisted mock channel outcomes
to the authenticated demo console:

```ts
{
  items: Array<{
    id: string;
    attemptId: string | null;
    shipmentId: string | null;
    orderId: string;
    externalOrderId: string;
    operation: string;
    channel: string;
    status: string;
    attempts: number;
    error: string | null;
    result: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}
```

Catalog and readiness are owned by Core at `GET /demo/catalog` and `GET /demo/readiness`. The virtual provider
uses the existing typed `salesChannel: 'medusa'` contract rather than adding a new sales-channel enum value.

## Ingestion and outbound behavior

Each run item constructs a schema-valid, confirmed, physical `OrderCreated` for the selected Core fixture variant.
The provider imports `@app/shared/demo-logistics.fixture`, so variant, master, version, SKU label, and price stay on
the same source as the Core seed and catalog response.
The demo repository passes a one-item virtual `ChannelOrderProvider` to
`OrderPollerOrchestrator.ingestProvider()`. That method reuses the normal mapping, change-hash, failure, typed
publisher, and transactional `event.outbox_events` path without invoking the normal active-site HTTP gate or
polling watermark. It does not publish raw Kafka payloads.

Run creation and items are inserted in one transaction. The unique request ID and input hash implement durable
request idempotency. Workers claim items with `FOR UPDATE SKIP LOCKED`; failed items are eligible on the next POST,
and abandoned processing claims expire after 30 seconds. If a process stops after the transactional outbox commit
but before the run-item acknowledgement, replay converges through the existing channel-order mapping and typed
event idempotency behavior.

Demo shipment dispatch, delivery, and dispatch recall operations still use the existing inbox and
`channel_dispatch_operations` persistence. Their `resultSnapshot` contains:

```ts
{
  mocked: true;
  mode: 'demo';
  operation: string;
  channel: string;
  externalOrderId: string;
  salesOrderId: string;
  shipmentId: string | null;
  dispatchAttemptId: string | null;
  providerIdempotencyKey: string;
  requestSnapshot: Record<string, unknown>;
  acknowledgedAt: string;
}
```

## Persistence

Migration `apps/channel-adapter/drizzle/20260916143425_big_thena.sql` adds:

- `demo_runs`: request/input hash, normalized inputs, aggregate status, requesting actor, and timestamps. Unique on
  `request_id` with checks for scenario, status, count, and quantity.
- `demo_run_items`: stable item/order/external IDs, claim lease, attempts, error, enqueue acknowledgement, and
  timestamps. Unique on `(run_id, sequence)`, `external_order_id`, and `order_id`, with a cascade foreign key and a
  claim index.

Because the original migration was already applied to the remote demo database during parallel deployment,
forward migration `apps/channel-adapter/drizzle/20260916145704_smart_barracuda.sql` adds the non-null
`fixture_version` column with the current version as its backfill default. The run input hash includes this version.

## Verification

The implementation was exercised with:

- `npx tsc --noEmit --pretty false` — repository-wide TypeScript check.
- `node_modules/.bin/tsc -p apps/channel-adapter/tsconfig.app.json --noEmit` — channel adapter typecheck.
- `node_modules/.bin/jest --runInBand apps/channel-adapter/src` — full channel adapter unit suite.
- `REQUIRE_DEMO_CHANNEL_DB=1 DEMO_CHANNEL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/demo_channel_adapter_scratch node_modules/.bin/jest --runInBand apps/channel-adapter/src/demo/demo-run.repository.integration.spec.ts`
  — real PostgreSQL idempotency, conflict, partial replay, transactional mapping, and schema-valid typed outbox
  coverage.
- `node_modules/.bin/eslint apps/channel-adapter/src/demo apps/channel-adapter/src/adapter.module.ts apps/channel-adapter/src/config/env.validation.ts apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.ts`
  — changed-source lint check.
- `npm run build:channel-adapter` — production webpack build.
- `git diff --check -- apps/channel-adapter docs/superpowers/reports/2026-09-16-demo-channel.md` — whitespace check.

The database integration verifies an `OrderCreated` reaches the real channel transactional outbox exactly once.
Kafka delivery and Core fulfillment-order creation remain Task 5 cross-service acceptance work. This Task 2 worker
performed no AWS deployment. Demo mode disables the Core order-cancellation-to-Medusa consumer; cancellation
remains internal to Core rather than creating an external channel cancellation operation.
