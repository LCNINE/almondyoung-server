import { expectOk, probe } from '../../tenancy/isolation-check/http';
import { BUCHEON_WAREHOUSE_ID, type OrderPathConfig } from './config';
import { judgeBox, type BoxObservation, type BoxProgress, type ShipmentView } from './plan';

/**
 * 주문 하나를 지금 수집시키고(5분 폴링을 기다리지 않는다) 부천 상자 + 재고 예약까지 기다린다.
 * 판정은 core·channel-adapter API 로만 한다 — 로그는 증거로 쓰지 않는다.
 */

const DEFAULT_TIMEOUT_MS = 90_000;
const EVERY_MS = 5_000;

interface SalesOrderRow {
  id: string;
  channelOrderId: string;
}
interface SalesOrderDetail {
  fulfillmentOrder?: { id: string } | null;
  lines: { matchingResolved?: boolean }[];
}

export async function syncAndWaitForBox(
  cfg: OrderPathConfig,
  staffToken: string,
  medusaOrderId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ salesOrderId: string; shipmentIds: string[] }> {
  await expectOk('POST', `${cfg.channelAdapterUrl}/adapter/orders/medusa/${encodeURIComponent(medusaOrderId)}/sync`, {
    bearer: cfg.channelAdapterInternalKey,
    json: {},
  });

  const deadline = Date.now() + timeoutMs;
  let obs = await observe(cfg, staffToken, medusaOrderId);
  let progress: BoxProgress = judgeBox(obs, BUCHEON_WAREHOUSE_ID);
  while (progress.kind !== 'ready' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, EVERY_MS));
    obs = await observe(cfg, staffToken, medusaOrderId);
    progress = judgeBox(obs, BUCHEON_WAREHOUSE_ID);
  }
  if (progress.kind !== 'ready') {
    throw new Error(
      `${medusaOrderId}: ${timeoutMs / 1000}초 안에 부천 상자가 안 섰다 — 멈춘 곳 ${progress.stage}` +
        (obs.salesOrderId ? ` (core 주문 ${obs.salesOrderId})` : ''),
    );
  }
  return { salesOrderId: obs.salesOrderId ?? '', shipmentIds: progress.shipmentIds };
}

async function observe(cfg: OrderPathConfig, bearer: string, medusaOrderId: string): Promise<BoxObservation> {
  const core = (path: string) => `${cfg.coreUrl}${path}`;
  const list = (await expectOk(
    'GET',
    core(`/sales-orders?keyword=${encodeURIComponent(medusaOrderId)}&keywordType=orderNo`),
    { bearer },
  )) as { data: SalesOrderRow[] };
  // keyword 는 ILIKE 부분일치다 — channel_order_id 가 정확히 같은 행만.
  const order = list.data.find((row) => row.channelOrderId === medusaOrderId);
  if (!order) {
    return {
      salesOrderId: null,
      quarantined: await quarantined(cfg, bearer, medusaOrderId),
      unmatchedLines: 0,
      fulfillmentOrderId: null,
      shipments: [],
    };
  }
  const detail = (await expectOk('GET', core(`/sales-orders/${order.id}`), { bearer })) as SalesOrderDetail;
  const fulfillmentOrderId = detail.fulfillmentOrder?.id ?? null;
  const shipments = fulfillmentOrderId
    ? ((await expectOk('GET', core(`/fulfillments/${fulfillmentOrderId}/shipments`), { bearer })) as ShipmentView[])
    : [];
  return {
    salesOrderId: order.id,
    quarantined: false,
    unmatchedLines: detail.lines.filter((line) => line.matchingResolved === false).length,
    fulfillmentOrderId,
    shipments,
  };
}

async function quarantined(cfg: OrderPathConfig, bearer: string, medusaOrderId: string): Promise<boolean> {
  const r = await probe(
    'GET',
    `${cfg.channelAdapterUrl}/adapter/order-collection-failures?channel=medusa&status=quarantined&limit=100`,
    { bearer },
  );
  const rows = (r.body as { data?: { externalOrderId?: string; external_order_id?: string }[] } | null)?.data ?? [];
  return rows.some((row) => (row.externalOrderId ?? row.external_order_id) === medusaOrderId);
}
