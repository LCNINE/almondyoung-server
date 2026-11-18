/**
 * 비상 출고 로컬 확인 (#1249) — 비상 경로로 나간 상자가 정식(앱) 경로와 같은 기록을 남겼는지 본다.
 *
 *   npx tsx scripts/ops/emergency-outbound/local/compare.ts --normal <상자 id,…> --emergency <상자 id,…>
 *
 * 상자마다 로컬 core DB 와 로컬 Medusa DB 에서 사실을 모아(`collect`, 읽기 전용) id·시각·작업자·forced 를
 * 뺀 모양(`shapeOf`)으로 바꾸고, 정식 상자 첫째를 기준으로 «정식 대비 다른 칸»을 찍는다. 비어 있어야 통과(종료 0).
 *
 * DB 주소는 `apps/core/.env`·`apps/medusa/.env` 의 `DATABASE_URL`(셸의 `CORE_DATABASE_URL`·`MEDUSA_DATABASE_URL`
 * 이 이긴다). localhost/127.0.0.1 이 아니면 거절한다. 연결은 `default_transaction_read_only` 로 연다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseEnv } from 'dotenv';
import postgres from 'postgres';

// ───────────────────────────────────────────── 모은 사실 (id·시각·작업자 포함)

export interface ShipmentFacts {
  shipmentId: string;
  status: string;
  lines: { id: string; fulfillmentOrderItemId: string; skuId: string; qty: number; forced: boolean }[];
  attempts: { id: string; kind: string; status: string; dispatchedAt: string | null }[];
  /** 발송한 시도(dispatched)가 가리키는 송장. 없으면 null */
  waybill: { id: string; source: string; status: string; trackingNo: string | null } | null;
  /** 발송한 시도의 원장 journal 에 든 행 + 시도 sources 가 가리키는 행 */
  shipEvents: {
    id: string;
    skuId: string;
    transitionType: string;
    fromState: string | null;
    toState: string | null;
    fromLocationId: string | null;
    quantity: number;
    eventStatus?: string;
    /** dispatch_attempt_sources.stock_event_id 로 이 행을 가리키는 source 가 있다 */
    linkedToSource: boolean;
    occurredAt: string;
    actorId: string | null;
  }[];
  foItems: { id: string; skuId: string; qty: number; shippedQty: number; status: string }[];
  outbox: { id: number; topic: string; eventType: string; createdAt: string }[];
  /** 상자의 판매주문 중 Medusa(자사몰) 주문. 자사몰 주문이 아니면 null */
  medusa: {
    orderId: string;
    /** Medusa 기본 fulfillment (order_fulfillment 링크) */
    fulfillments: { id: string; shippedAt: string | null; canceledAt: string | null; trackingNumbers: string[] }[];
    /** channel-adapter 가 order.metadata 에 쓰는 core 출고 투영 */
    projection: {
      shippingStatus: string | null;
      trackingNumber: string | null;
      /** coreShipmentAttempts 중 이 상자의 것 */
      attempts: { dispatchAttemptId: string; status: string | null; trackingNo: string | null }[];
    };
  } | null;
}

// ───────────────────────────────────────────── 비교할 모양

type TrackingRelation = 'matches-waybill' | 'missing' | 'other' | 'n/a';

export interface ComparableShape {
  status: string;
  attempts: string[];
  waybill: string;
  ship: { kinds: string[]; qtyMatchesLines: boolean };
  foi: { shippedMatchesLines: boolean; statuses: string[] };
  outbox: string[];
  medusa: {
    linked: boolean;
    fulfillments: number;
    fulfillmentTracking: TrackingRelation;
    fulfillmentShipped: 'all' | 'some' | 'none' | 'n/a';
    projectionStatus: string | null;
    projectionTracking: TrackingRelation;
    attempts: number;
    attemptStatuses: string[];
    attemptTracking: TrackingRelation;
  };
}

const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

function sumBy<T>(rows: T[], key: (r: T) => string, qty: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + qty(r));
  return m;
}

const sameMap = (a: Map<string, number>, b: Map<string, number>): boolean =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

function relation(value: string | null | undefined, waybillNo: string | null): TrackingRelation {
  if (!value) return 'missing';
  return waybillNo && value === waybillNo ? 'matches-waybill' : 'other';
}

/** 여러 값의 관계 하나로: 하나라도 없으면 missing, 하나라도 다르면 other, 비었으면 n/a */
function relationOfAll(values: (string | null)[], waybillNo: string | null): TrackingRelation {
  if (values.length === 0) return 'n/a';
  const rels = values.map((v) => relation(v, waybillNo));
  if (rels.includes('missing')) return 'missing';
  if (rels.includes('other')) return 'other';
  return 'matches-waybill';
}

/** 순수 함수. id·시각·작업자·forced 표시를 뺀다. SKU·수량은 «상자 자기 라인과 맞는가»로만 남긴다. */
export function shapeOf(f: ShipmentFacts): ComparableShape {
  const lines = f.lines.filter((l) => l.qty > 0);
  const waybillNo = f.waybill?.trackingNo ?? null;

  const lineQtyBySku = sumBy(
    lines,
    (l) => l.skuId,
    (l) => l.qty,
  );
  const posted = f.shipEvents.filter((e) => e.transitionType === 'SHIP' && (e.eventStatus ?? 'POSTED') === 'POSTED');
  const shipQtyBySku = sumBy(
    posted,
    (e) => e.skuId,
    (e) => e.quantity,
  );

  const lineQtyByFoi = sumBy(
    lines,
    (l) => l.fulfillmentOrderItemId,
    (l) => l.qty,
  );
  const foiById = new Map(f.foItems.map((i) => [i.id, i]));
  const foiShipped = [...lineQtyByFoi].every(([id, qty]) => foiById.get(id)?.shippedQty === qty);

  const m = f.medusa;
  const live = m ? m.fulfillments.filter((x) => !x.canceledAt) : [];
  const shippedCount = live.filter((x) => x.shippedAt).length;

  return {
    status: f.status,
    attempts: f.attempts.map((a) => `${a.kind}:${a.status}`).sort(),
    waybill: f.waybill ? `${f.waybill.source}:${f.waybill.status}` : 'none',
    ship: {
      kinds: uniqSorted(
        f.shipEvents.map(
          (e) =>
            `${e.transitionType} ${e.fromState ?? '-'}→${e.toState ?? '-'} ${e.eventStatus ?? 'POSTED'}` +
            ` from-location:${e.fromLocationId ? 'yes' : 'no'} source:${e.linkedToSource ? 'yes' : 'no'}`,
        ),
      ),
      qtyMatchesLines: lines.length > 0 && sameMap(lineQtyBySku, shipQtyBySku),
    },
    foi: {
      shippedMatchesLines: lineQtyByFoi.size > 0 && foiShipped,
      statuses: uniqSorted([...lineQtyByFoi.keys()].map((id) => foiById.get(id)?.status ?? 'missing')),
    },
    outbox: uniqSorted(f.outbox.map((o) => `${o.topic}:${o.eventType}`)),
    medusa: {
      linked: m !== null,
      fulfillments: live.length,
      fulfillmentTracking: relationOfAll(
        live.map((x) => x.trackingNumbers.find((t) => t === waybillNo) ?? x.trackingNumbers[0] ?? null),
        waybillNo,
      ),
      fulfillmentShipped:
        live.length === 0 ? 'n/a' : shippedCount === live.length ? 'all' : shippedCount === 0 ? 'none' : 'some',
      projectionStatus: m?.projection.shippingStatus ?? null,
      projectionTracking: m ? relation(m.projection.trackingNumber, waybillNo) : 'n/a',
      attempts: m?.projection.attempts.length ?? 0,
      attemptStatuses: (m?.projection.attempts ?? []).map((a) => a.status ?? 'missing').sort(),
      attemptTracking: relationOfAll(
        (m?.projection.attempts ?? []).map((a) => a.trackingNo),
        waybillNo,
      ),
    },
  };
}

export interface ShapeDiff {
  field: string;
  normal: string;
  emergency: string;
}

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix, JSON.stringify(value));
}

/** 다른 칸만. 배열은 통째로 한 칸이다 */
export function diffShapes(normal: ComparableShape, emergency: ComparableShape): ShapeDiff[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(normal, '', a);
  flatten(emergency, '', b);
  const fields = uniqSorted([...a.keys(), ...b.keys()]);
  return fields
    .filter((k) => a.get(k) !== b.get(k))
    .map((k) => ({ field: k, normal: a.get(k) ?? '(없음)', emergency: b.get(k) ?? '(없음)' }));
}

// ───────────────────────────────────────────── I/O (로컬 전용, 읽기 전용)

const REPO = join(__dirname, '..', '..', '..', '..');

function envUrl(override: string | undefined, envFile: string): string {
  if (override) return override;
  const path = join(REPO, envFile);
  const url = existsSync(path) ? parseEnv(readFileSync(path)).DATABASE_URL : undefined;
  if (!url) throw new Error(`${envFile} 에 DATABASE_URL 이 없다 → npm run bootstrap:e2e:local`);
  return url;
}

function assertLocal(url: string, label: string): void {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1')
    throw new Error(`로컬 전용이다. ${label} DB 가 ${host} 를 가리킨다`);
}

type Sql = postgres.Sql;

function open(url: string): Sql {
  return postgres(url, {
    max: 1,
    onnotice: () => undefined,
    connection: { application_name: 'emergency-outbound-compare', default_transaction_read_only: true },
  });
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

async function collectMedusa(medusa: Sql, orderId: string, shipmentId: string): Promise<ShipmentFacts['medusa']> {
  const orders = await medusa<{ metadata: Record<string, unknown> | null }[]>`
    select metadata from "order" where id = ${orderId} and deleted_at is null`;
  const fulfillments = await medusa<
    { id: string; shipped_at: Date | null; canceled_at: Date | null; tracking_numbers: string[] }[]
  >`
    select f.id, f.shipped_at, f.canceled_at,
           coalesce(array_agg(l.tracking_number) filter (where l.id is not null), '{}') as tracking_numbers
      from order_fulfillment ofl
      join fulfillment f on f.id = ofl.fulfillment_id and f.deleted_at is null
      left join fulfillment_label l on l.fulfillment_id = f.id and l.deleted_at is null
     where ofl.order_id = ${orderId} and ofl.deleted_at is null
     group by f.id, f.shipped_at, f.canceled_at`;
  const meta = orders[0]?.metadata ?? {};
  const rawAttempts: unknown[] = Array.isArray(meta.coreShipmentAttempts) ? meta.coreShipmentAttempts : [];
  return {
    orderId,
    fulfillments: fulfillments.map((r) => ({
      id: r.id,
      shippedAt: iso(r.shipped_at),
      canceledAt: iso(r.canceled_at),
      trackingNumbers: r.tracking_numbers,
    })),
    projection: {
      shippingStatus: str(meta.coreShippingStatus),
      trackingNumber: str(meta.coreTrackingNumber),
      attempts: rawAttempts
        .filter(isRecord)
        .filter((a) => a.shipmentId === shipmentId)
        .map((a) => ({
          dispatchAttemptId: str(a.dispatchAttemptId) ?? '',
          status: str(a.status),
          trackingNo: isRecord(a.invoice) ? str(a.invoice.trackingNo) : null,
        })),
    },
  };
}

interface FoiRow {
  id: string;
  fulfillment_order_id: string;
  sales_order_id: string | null;
  sku_id: string;
  qty: number;
  shipped_qty: number;
  status: string;
}
interface SalesOrderRow {
  id: string;
  sales_channel: string;
  channel_order_id: string;
}
interface WaybillRow {
  id: string;
  source: string;
  status: string;
  tracking_no: string | null;
}

export async function collect(core: Sql, medusa: Sql, shipmentId: string): Promise<ShipmentFacts> {
  const [shipment] = await core<{ id: string; status: string }[]>`
    select id, status from shipments where id = ${shipmentId}`;
  if (!shipment) throw new Error(`상자 ${shipmentId} 가 로컬 core DB 에 없다`);

  const lines = await core<
    { id: string; fulfillment_order_item_id: string; sku_id: string; qty: number; forced: boolean }[]
  >`
    select id, fulfillment_order_item_id, sku_id, qty, forced
      from shipment_lines where shipment_id = ${shipmentId} order by id`;

  const attempts = await core<
    { id: string; kind: string; status: string; waybill_id: string | null; dispatched_at: Date | null }[]
  >`
    select id, kind, status, waybill_id, dispatched_at
      from dispatch_attempts where shipment_id = ${shipmentId} order by attempt_no`;
  const dispatched = attempts.filter((a) => a.status === 'dispatched');
  const waybillId = dispatched[dispatched.length - 1]?.waybill_id ?? null;
  const [waybill]: WaybillRow[] = waybillId
    ? await core<WaybillRow[]>`
        select id, source, status, tracking_no from waybills where id = ${waybillId}`
    : [];

  // shipment-dispatch.integration.spec.ts 와 같은 사슬: dispatch_attempts → dispatch_attempt_sources.stock_event_id →
  // stock_events. 같은 시도의 journal(dispatch_attempts.stock_journal_id = stock_events.journal_id)에 든 행도 함께 본다 —
  // source 에 안 걸린 원장 행이 있으면 source:no 로 드러난다.
  const events = await core<
    {
      id: string;
      sku_id: string;
      transition_type: string;
      from_state: string | null;
      to_state: string | null;
      from_location_id: string | null;
      quantity: number;
      event_status: string;
      linked_to_source: boolean;
      occurred_at: Date;
      actor_id: string | null;
    }[]
  >`
    select e.id, e.sku_id, e.transition_type, e.from_state, e.to_state, e.from_location_id, e.quantity,
           e.event_status, e.occurred_at, j.actor_id,
           exists (select 1 from dispatch_attempt_sources s
                    where s.stock_event_id = e.id and s.dispatch_attempt_id = a.id) as linked_to_source
      from dispatch_attempts a
      join stock_events e
        on e.journal_id = a.stock_journal_id
        or e.id in (select s.stock_event_id from dispatch_attempt_sources s where s.dispatch_attempt_id = a.id)
      left join stock_journals j on j.id = e.journal_id
     where a.shipment_id = ${shipmentId} and a.status = 'dispatched'
     order by e.id`;

  const foiIds = [...new Set(lines.map((l) => l.fulfillment_order_item_id))];
  const foItems: FoiRow[] = foiIds.length
    ? await core<FoiRow[]>`
        select id, fulfillment_order_id, sales_order_id, sku_id, qty, shipped_qty, status
          from fulfillment_order_items where id in ${core(foiIds)}`
    : [];

  const soIds = [...new Set(foItems.flatMap((i) => (i.sales_order_id ? [i.sales_order_id] : [])))];
  const salesOrders: SalesOrderRow[] = soIds.length
    ? await core<SalesOrderRow[]>`
        select id, sales_channel, channel_order_id from sales_orders where id::text in ${core(soIds)}`
    : [];

  // shipment-dispatch.integration.spec.ts 가 지우는 outbox 묶음(상자·FO·원장 행) + 판매주문(SalesOrderShipmentDispatched)
  // + 시도. SKU 를 aggregate 로 쓰는 이벤트는 다른 상자와 섞이므로 넣지 않는다
  const aggregates = [
    shipmentId,
    ...new Set(foItems.map((i) => i.fulfillment_order_id)),
    ...soIds,
    ...events.map((e) => e.id),
    ...attempts.map((a) => a.id),
  ];
  const outbox = await core<{ id: number; topic: string; event_type: string; created_at: Date }[]>`
    select id, topic, event_type, created_at from event.outbox_events
     where aggregate_id in ${core(aggregates)} order by id`;

  const medusaOrders = salesOrders.filter((o) => o.sales_channel === 'medusa');
  if (medusaOrders.length > 1) {
    console.warn(`  ! 상자 ${shipmentId} 에 자사몰 주문이 ${medusaOrders.length}개다 — 첫째만 본다`);
  }

  return {
    shipmentId,
    status: shipment.status,
    lines: lines.map((l) => ({
      id: l.id,
      fulfillmentOrderItemId: l.fulfillment_order_item_id,
      skuId: l.sku_id,
      qty: l.qty,
      forced: l.forced,
    })),
    attempts: attempts.map((a) => ({ id: a.id, kind: a.kind, status: a.status, dispatchedAt: iso(a.dispatched_at) })),
    waybill: waybill
      ? { id: waybill.id, source: waybill.source, status: waybill.status, trackingNo: waybill.tracking_no }
      : null,
    shipEvents: events.map((e) => ({
      id: e.id,
      skuId: e.sku_id,
      transitionType: e.transition_type,
      fromState: e.from_state,
      toState: e.to_state,
      fromLocationId: e.from_location_id,
      quantity: e.quantity,
      eventStatus: e.event_status,
      linkedToSource: e.linked_to_source,
      occurredAt: e.occurred_at.toISOString(),
      actorId: e.actor_id,
    })),
    foItems: foItems.map((i) => ({
      id: i.id,
      skuId: i.sku_id,
      qty: i.qty,
      shippedQty: i.shipped_qty,
      status: i.status,
    })),
    outbox: outbox.map((o) => ({
      id: o.id,
      topic: o.topic,
      eventType: o.event_type,
      createdAt: o.created_at.toISOString(),
    })),
    medusa: medusaOrders[0] ? await collectMedusa(medusa, medusaOrders[0].channel_order_id, shipmentId) : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsOf(argv: string[], flag: string): string[] {
  const i = argv.indexOf(flag);
  const raw = i >= 0 ? argv[i + 1] : undefined;
  if (!raw || raw.startsWith('--')) throw new Error(`${flag} <상자 id,…> 가 필요하다`);
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = ids.filter((id) => !UUID.test(id));
  if (bad.length) throw new Error(`${flag}: 상자 id 가 아니다 — ${bad.join(', ')}`);
  return ids;
}

function printDiffs(title: string, diffs: ShapeDiff[]): void {
  console.log(`${title}: ${diffs.length === 0 ? '없음' : `${diffs.length}칸`}`);
  for (const d of diffs) console.log(`  - ${d.field}: 정식 ${d.normal} / 이쪽 ${d.emergency}`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const normalIds = idsOf(argv, '--normal');
  const emergencyIds = idsOf(argv, '--emergency');

  const coreUrl = envUrl(process.env.CORE_DATABASE_URL, 'apps/core/.env');
  const medusaUrl = envUrl(process.env.MEDUSA_DATABASE_URL, 'apps/medusa/.env');
  assertLocal(coreUrl, 'core');
  assertLocal(medusaUrl, 'Medusa');

  const core = open(coreUrl);
  const medusa = open(medusaUrl);
  try {
    const shapes = new Map<string, ComparableShape>();
    for (const id of [...normalIds, ...emergencyIds]) {
      const shape = shapeOf(await collect(core, medusa, id));
      shapes.set(id, shape);
      console.log(`\n== 상자 ${id} (${normalIds.includes(id) ? '정식' : '비상'})`);
      console.log(JSON.stringify(shape, null, 2));
      // 양쪽이 같이 비면 «다른 칸 0» 이 아무것도 증명하지 않는다 — 통과와 따로 알린다
      if (shape.outbox.length === 0) {
        console.log('  ! outbox 행이 없다 — 02:00 KST 정리 cron 이 지웠거나 안 나갔다. 같은 날 다시 잰다');
      }
      if (shape.medusa.linked && shape.medusa.attempts === 0) {
        console.log('  ! Medusa 출고 투영이 없다 — channel-adapter 가 떠 있었는지 본다');
      }
    }

    const reference = shapes.get(normalIds[0])!;
    let differing = 0;
    console.log('');
    for (const id of normalIds.slice(1)) {
      const diffs = diffShapes(reference, shapes.get(id)!);
      differing += diffs.length;
      printDiffs(`정식끼리 다른 칸 (${normalIds[0]} 대비 ${id})`, diffs);
    }
    for (const id of emergencyIds) {
      const diffs = diffShapes(reference, shapes.get(id)!);
      differing += diffs.length;
      printDiffs(`정식 대비 다른 칸 (${id})`, diffs);
    }
    console.log(differing === 0 ? '\n통과 — 다른 칸 없음' : `\n실패 — 다른 칸 ${differing}`);
    return differing === 0 ? 0 : 1;
  } finally {
    await core.end();
    await medusa.end();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`실패: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
