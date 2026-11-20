import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { uniqueInOrder } from '../services/consolidation-shipment-reads';
import { isUntrustedExternalLine } from '../services/external-line-identity';
import { missingRecipientFields } from '../services/recipient-completeness';
import { compatibleShippingProfileId } from '../services/shipping-profile';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 바인드 변수 한도 안에서 판매주문 품목을 나눠 찾는다
const LINE_LOOKUP_CHUNK = 5000;

export interface NeedsInfoSku {
  name: string;
  code: string;
}

export type NeedsInfoIssue =
  | { kind: 'shipping_profile_missing'; skus: NeedsInfoSku[] }
  | { kind: 'shipping_profile_mixed'; skus: (NeedsInfoSku & { profileName: string })[] }
  | { kind: 'recipient_incomplete'; fields: string[] }
  | { kind: 'channel_item_unknown'; skus: NeedsInfoSku[] };

export interface NeedsInfoLine {
  skuId: string;
  skuName: string;
  skuCode: string;
  profileId: string | null;
  profileName: string | null;
}

/** 정보 부족 판정 줄에 그 상자 줄 자체(나누기 요청에 쓰는 id·버전·수량)를 더한 것 */
export interface NeedsInfoShipmentLine extends NeedsInfoLine {
  lineId: string;
  lineVersion: number;
  qty: number;
}

/**
 * 상자 확정이 거절할 «정보 부족» 문제를 모두 고른다. 출고 준비 분류와 같은 판정(배송 프로필 → 수령인 → 쇼핑몰 품목 번호)
 * 순서로 내므로 첫 항목이 목록의 사유다.
 */
export function needsInfoIssues(input: {
  lines: NeedsInfoLine[];
  recipientSnapshot: unknown;
  untrustedSkuIds: ReadonlySet<string>;
}): NeedsInfoIssue[] {
  const issues: NeedsInfoIssue[] = [];
  const skus = uniqueBySku(input.lines);

  if (compatibleShippingProfileId(input.lines.map((line) => line.profileId)) === null) {
    const missing = skus.filter((line) => line.profileId === null);

    issues.push(
      missing.length > 0 || skus.length === 0
        ? { kind: 'shipping_profile_missing', skus: missing.map(skuOf) }
        : {
            kind: 'shipping_profile_mixed',
            skus: skus.map((line) => ({ ...skuOf(line), profileName: line.profileName ?? '' })),
          },
    );
  }

  const fields = missingRecipientFields(input.recipientSnapshot);

  if (fields.length > 0) {
    issues.push({ kind: 'recipient_incomplete', fields });
  }

  const untrusted = skus.filter((line) => input.untrustedSkuIds.has(line.skuId));

  if (untrusted.length > 0) {
    issues.push({ kind: 'channel_item_unknown', skus: untrusted.map(skuOf) });
  }

  return issues;
}

export function needsInfoReasonText(issue: NeedsInfoIssue): string {
  switch (issue.kind) {
    case 'shipping_profile_missing':
      return '배송 프로필이 없는 상품이 있어요';
    case 'shipping_profile_mixed':
      return '배송 프로필이 상품마다 달라요';
    case 'recipient_incomplete':
      return '수령인 정보가 비어 있어요';
    case 'channel_item_unknown':
      return '쇼핑몰 품목 번호가 없거나 맞지 않아요';
  }
}

function skuOf(line: NeedsInfoLine): NeedsInfoSku {
  return { name: line.skuName, code: line.skuCode };
}

function uniqueBySku(lines: NeedsInfoLine[]): NeedsInfoLine[] {
  const seen = new Map<string, NeedsInfoLine>();

  for (const line of lines) {
    if (!seen.has(line.skuId)) {
      seen.set(line.skuId, line);
    }
  }

  return [...seen.values()];
}

/** 상자마다 «정보 부족» 판정에 필요한 줄(SKU 코드·배송 프로필 이름). */
export async function loadNeedsInfoLines(
  trx: DbTx,
  shipmentIds: string[],
): Promise<Map<string, NeedsInfoShipmentLine[]>> {
  const byShipment = new Map<string, NeedsInfoShipmentLine[]>();

  if (shipmentIds.length === 0) {
    return byShipment;
  }

  const rows = await trx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      lineId: wmsTables.shipmentLines.id,
      lineVersion: wmsTables.shipmentLines.lineVersion,
      qty: wmsTables.shipmentLines.qty,
      skuId: wmsTables.skus.id,
      skuName: wmsTables.skus.name,
      skuCode: wmsTables.skus.code,
      profileId: wmsTables.skus.deliveryProfileId,
      profileName: wmsTables.deliveryProfiles.name,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .leftJoin(wmsTables.deliveryProfiles, eq(wmsTables.deliveryProfiles.id, wmsTables.skus.deliveryProfileId))
    .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
    .orderBy(wmsTables.shipmentLines.createdAt, wmsTables.shipmentLines.id);

  for (const { shipmentId, ...line } of rows) {
    byShipment.set(shipmentId, [...(byShipment.get(shipmentId) ?? []), line]);
  }

  return byShipment;
}

/**
 * 상자 확정이 같은 판정으로 거절하는 줄의 SKU — 다시 눌러도 같으니 «정보 부족»으로 둔다.
 * 판매주문 품목은 기본키로 찾는다 — 출고 품목의 참조는 문자열이라 조인하면 인덱스를 못 쓴다.
 */
export async function loadUntrustedLineSkus(trx: DbTx, shipmentIds: string[]): Promise<Map<string, Set<string>>> {
  const bySku = new Map<string, Set<string>>();

  if (shipmentIds.length === 0) {
    return bySku;
  }

  const links = await trx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      skuId: wmsTables.shipmentLines.skuId,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
  // 상자 확정은 `id::text` 와 그대로 견준다 — 같은 판정이 되도록 소문자 uuid 꼴만 찾는다
  const lineIds = uniqueInOrder(
    links.flatMap(({ salesOrderLineId }) =>
      salesOrderLineId && UUID.test(salesOrderLineId) ? [salesOrderLineId] : [],
    ),
  );
  const untrusted = new Set<string>();

  for (let start = 0; start < lineIds.length; start += LINE_LOOKUP_CHUNK) {
    const origins = await trx
      .select({
        id: wmsTables.salesOrderLines.id,
        salesChannel: wmsTables.salesOrders.salesChannel,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        channelProductId: wmsTables.salesOrderLines.channelProductId,
        exchangeReturnLineId: wmsTables.salesOrderLines.exchangeReturnLineId,
      })
      .from(wmsTables.salesOrderLines)
      .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.salesOrderLines.salesOrderId))
      .where(inArray(wmsTables.salesOrderLines.id, lineIds.slice(start, start + LINE_LOOKUP_CHUNK)));

    for (const origin of origins.filter(isUntrustedExternalLine)) {
      untrusted.add(origin.id);
    }
  }

  for (const { shipmentId, skuId, salesOrderLineId } of links) {
    if (salesOrderLineId && untrusted.has(salesOrderLineId)) {
      bySku.set(shipmentId, (bySku.get(shipmentId) ?? new Set()).add(skuId));
    }
  }

  return bySku;
}
