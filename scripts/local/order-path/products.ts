import { expectOk, probe, waitFor } from '../../tenancy/isolation-check/http';
import { BUCHEON_WAREHOUSE_ID, medusaAdminHeaders, type OrderPathConfig } from './config';
import {
  ORDER_PATH_LOCATION,
  ORDER_PATH_PRICE,
  ORDER_PATH_PRODUCTS,
  STOCK_TARGET,
  pickExistingMaster,
  skuBarcodeFor,
  stockTopUpDelta,
  type MasterSummary,
} from './plan';

/**
 * 자사몰 주문이 가능한 상품을 «API 로만» 갖춘다(#1440). DB 에 직접 쓰면 outbox → channel-adapter → Medusa 투영이
 * 생기지 않아 실제 경로를 검증하지 못한다. 다시 돌려도 상품·SKU·위치·배송 프로필이 늘지 않는다 — 이름·고정 바코드로 찾는다.
 */

export interface SeededVariant {
  productName: string;
  masterId: string;
  variantId: string;
  medusaVariantId: string;
  skuId: string;
  available: number;
}

const DELIVERY_PROFILE_NAME = '[E2E] 주문 경로 배송';
const WAIT_MS = 60_000;

type Log = (line: string) => void;

interface CoreVariant {
  id: string;
  optionValues?: unknown;
}
interface MedusaProduct {
  id: string;
  metadata: Record<string, unknown> | null;
  variants: { id: string; metadata: Record<string, unknown> | null }[];
}

export async function ensureOrderPathProducts(
  cfg: OrderPathConfig,
  staffToken: string,
  log: Log = console.log,
): Promise<SeededVariant[]> {
  const core = (path: string) => `${cfg.coreUrl}${path}`;
  const bearer = staffToken;

  const deliveryProfileId = await ensureDeliveryProfile(cfg, bearer, log);
  const locationId = await ensureLocation(cfg, bearer, log);

  const seeded: SeededVariant[] = [];
  for (const product of ORDER_PATH_PRODUCTS) {
    const { masterId, versionId } = await ensurePublishedMaster(cfg, bearer, product, log);
    const detail = (await expectOk('GET', core(`/masters/${masterId}/versions/${versionId}`), { bearer })) as {
      variants: CoreVariant[];
    };
    const medusa = await waitForMedusaProjection(cfg, masterId, detail.variants.length);

    for (const [index, variant] of detail.variants.entries()) {
      const option = product.options.length > 0 ? optionLabel(variant, product.options[index]) : null;
      const medusaVariant = medusa.variants.find((v) => v.metadata?.pimVariantId === variant.id);
      if (!medusaVariant) throw new Error(`${product.name}: Medusa 에 variant ${variant.id} 가 투영되지 않았다`);
      const skuId = await ensureSku(cfg, bearer, product.name, option, deliveryProfileId, log);
      const available = await topUpStock(cfg, bearer, skuId, locationId, log);
      await expectOk('PUT', core(`/matchings/${variant.id}`), {
        bearer,
        json: { masterId, links: [{ skuId, quantity: 1 }] },
      });
      seeded.push({
        productName: product.name,
        masterId,
        variantId: variant.id,
        medusaVariantId: medusaVariant.id,
        skuId,
        available,
      });
    }
    await waitForSellable(cfg, masterId);
  }
  return seeded;
}

/** optionValues 의 모양은 core 가 정한다 — 표시명 문자열을 찾아 쓰고, 못 찾으면 순서로 붙인 값을 쓴다. */
function optionLabel(variant: CoreVariant, fallback: string): string {
  const text = JSON.stringify(variant.optionValues ?? '');
  const hit = ['A', 'B'].find((label) => text.includes(`"${label}"`));
  return hit ?? fallback;
}

async function ensureDeliveryProfile(cfg: OrderPathConfig, bearer: string, log: Log): Promise<string> {
  const url = `${cfg.coreUrl}/inventory/delivery-profiles`;
  const rows = (await expectOk('GET', url, { bearer })) as { id: string; name: string }[];
  const found = rows.find((r) => r.name === DELIVERY_PROFILE_NAME);
  if (found) return found.id;
  // 🔒 공개 레포 — 발송인·주소는 가짜 값이다(env-templates 의 HANJIN_SENDER_* 자리표시자와 같은 결).
  const address = { postalCode: '00000', roadAddress: '로컬 발송 주소', detailAddress: '1층' };
  const made = (await expectOk('POST', url, {
    bearer,
    json: {
      name: DELIVERY_PROFILE_NAME,
      sourceType: 'in_house',
      sender: { name: '로컬 발송인', phone: '01000000000' },
      originAddress: address,
      returnAddress: { ...address, phone: '01000000000' },
      carrierAccountRef: 'dev-local',
      supportedFulfillmentModes: ['in_house'],
    },
  })) as { id: string };
  log(`배송 프로필을 만들었다: ${made.id}`);
  return made.id;
}

async function ensureLocation(cfg: OrderPathConfig, bearer: string, log: Log): Promise<string> {
  const base = `${cfg.coreUrl}/locations/warehouses/${BUCHEON_WAREHOUSE_ID}`;
  const { columnName, rackNumber } = ORDER_PATH_LOCATION;
  const find = async () => {
    const list = (await expectOk(
      'GET',
      `${base}?type=standard&columnName=${columnName}&rackNumber=${rackNumber}&page=1&limit=10`,
      { bearer },
    )) as { items: { id: string; code: string }[] };
    return list.items[0] ?? null;
  };
  const existing = await find();
  if (existing) return existing.id;
  // 열이 이미 있으면 400(중복) — 랙 만들기가 진짜 판정이다.
  await probe('POST', `${base}/columns`, { bearer, json: { columnName } });
  await expectOk('POST', `${base}/racks`, {
    bearer,
    json: { columnName, rackNumber, binSettings: { autoGenerate: true, standardBins: { start: 1, end: 1 } } },
  });
  const made = await find();
  if (!made) throw new Error(`부천 위치 ${columnName}-${rackNumber} 를 만들었는데 목록에 없다`);
  log(`부천 위치를 만들었다: ${made.code}`);
  return made.id;
}

async function ensurePublishedMaster(
  cfg: OrderPathConfig,
  bearer: string,
  product: (typeof ORDER_PATH_PRODUCTS)[number],
  log: Log,
): Promise<{ masterId: string; versionId: string }> {
  const core = (path: string) => `${cfg.coreUrl}${path}`;
  const list = (await expectOk(
    'GET',
    core(`/masters?mode=all&page=1&limit=100&q=${encodeURIComponent(product.name)}`),
    { bearer },
  )) as { data: MasterSummary[] };
  const existing = pickExistingMaster(list.data, product.name);
  if (existing?.published) return existing;

  let target = existing;
  if (!target) {
    const made = (await expectOk('POST', core('/masters'), { bearer })) as { id: string; masterId: string };
    target = { masterId: made.masterId, versionId: made.id, published: false };
    log(`상품을 만들었다: ${product.name} (${made.masterId})`);
  }
  const { masterId, versionId } = target;
  await expectOk('PUT', core(`/masters/${masterId}/versions/${versionId}`), {
    bearer,
    json: {
      name: product.name,
      brand: 'E2E',
      supplyPrice: 6000,
      marketPrice: 15000,
      fulfillmentKind: 'physical',
      ...(product.options.length > 0
        ? {
            optionDiff: {
              add: [{ displayName: '색상', values: product.options.map((displayName) => ({ displayName })) }],
            },
          }
        : {}),
    },
  });
  // 판매가는 초안에만 넣을 수 있다 — 발행 전에. 안 넣으면 0원이 그대로 팔린다(문서 §8-D).
  await expectOk('PUT', core(`/versions/${versionId}/pricing/rules`), {
    bearer,
    json: {
      basePriceRules: [
        {
          order: 1,
          layer: 'base_price',
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: ORDER_PATH_PRICE,
        },
      ],
      membershipPriceRules: [],
    },
  });
  await expectOk('PATCH', core(`/masters/${masterId}/versions/${versionId}/publish`), { bearer, json: {} });
  log(`발행했다: ${product.name}`);
  return { masterId, versionId };
}

/** 발행 → ProductMasterActiveVersionChanged → channel-adapter → Medusa. 식별자 셋이 심길 때까지 기다린다. */
async function waitForMedusaProjection(
  cfg: OrderPathConfig,
  masterId: string,
  variantCount: number,
): Promise<MedusaProduct> {
  const url =
    `${cfg.medusaUrl}/admin/products?handle=${encodeURIComponent(masterId)}` +
    '&fields=id,metadata,*variants,+variants.metadata';
  const read = async () => {
    const r = await probe('GET', url, { headers: medusaAdminHeaders(cfg) });
    const products = (r.body as { products?: MedusaProduct[] } | null)?.products ?? [];
    return products[0] ?? null;
  };
  const complete = (p: MedusaProduct | null) =>
    !!p &&
    !!p.metadata?.pimMasterId &&
    !!p.metadata?.pimVersionId &&
    p.variants.length >= variantCount &&
    p.variants.every((v) => !!v.metadata?.pimVariantId);
  const last = await waitFor(read, complete, WAIT_MS);
  if (!last || !complete(last)) {
    const missing = !last
      ? 'Medusa 상품 자체'
      : [
          !last.metadata?.pimMasterId && 'product.metadata.pimMasterId',
          !last.metadata?.pimVersionId && 'product.metadata.pimVersionId',
          last.variants.some((v) => !v.metadata?.pimVariantId) && 'variant.metadata.pimVariantId',
        ]
          .filter(Boolean)
          .join(', ');
    throw new Error(
      `Medusa 투영이 ${WAIT_MS / 1000}초 안에 안 왔다(${masterId}) — 비어 있음: ${missing}. logs/channel-adapter.log 를 볼 것`,
    );
  }
  return last;
}

async function ensureSku(
  cfg: OrderPathConfig,
  bearer: string,
  productName: string,
  option: string | null,
  deliveryProfileId: string,
  log: Log,
): Promise<string> {
  const barcode = skuBarcodeFor(productName, option);
  const found = (await expectOk('GET', `${cfg.coreUrl}/inventory/skus?barcode=${encodeURIComponent(barcode)}`, {
    bearer,
  })) as { id: string }[];
  if (found[0]) return found[0].id;
  const made = (await expectOk('POST', `${cfg.coreUrl}/inventory/skus`, {
    bearer,
    json: { name: `${productName} SKU${option ? ` ${option}` : ''}`, stockType: 'physical', deliveryProfileId },
  })) as { id: string };
  await expectOk('POST', `${cfg.coreUrl}/inventory/skus/${made.id}/barcodes`, { bearer, json: { barcode } });
  log(`SKU 를 만들었다: ${barcode} (${made.id})`);
  return made.id;
}

async function topUpStock(cfg: OrderPathConfig, bearer: string, skuId: string, locationId: string, log: Log) {
  const read = async () => {
    const r = (await expectOk('GET', `${cfg.coreUrl}/inventory/stocks/sku/${skuId}/warehouse/${BUCHEON_WAREHOUSE_ID}`, {
      bearer,
    })) as { summary: { availableQuantity: number } | null };
    return r.summary?.availableQuantity ?? null;
  };
  const available = await read();
  const delta = stockTopUpDelta(available, STOCK_TARGET);
  if (delta === 0) return available ?? 0;
  await expectOk('POST', `${cfg.coreUrl}/inventory/stocks/adjust`, {
    bearer,
    json: {
      skuId,
      warehouseId: BUCHEON_WAREHOUSE_ID,
      locationId,
      delta,
      reason: 'E2E 주문 경로 재고 채우기',
      // 호출마다 새 키 — 현재 수량으로 만들면 주문으로 같은 수량이 돌아왔을 때 조용히 건너뛴다.
      idempotencyKey: `e2e-order-path:${skuId}:${Date.now()}`,
    },
  });
  log(`부천 재고를 채웠다: ${skuId} +${delta}`);
  return (await read()) ?? 0;
}

/** 재고·매칭이 Medusa 판매 가능 수량까지 반영됐는지 — 안 되면 장바구니 담기가 재고 부족으로 거절된다. */
async function waitForSellable(cfg: OrderPathConfig, masterId: string): Promise<void> {
  const url =
    `${cfg.medusaUrl}/store/products?handle=${encodeURIComponent(masterId)}` +
    '&fields=id,*variants,+variants.inventory_quantity,+variants.manage_inventory';
  type StoreVariant = { id: string; inventory_quantity?: number | null; manage_inventory?: boolean | null };
  const read = async () => {
    const r = await probe('GET', url, { headers: { 'x-publishable-api-key': cfg.publishableKey } });
    return (r.body as { products?: { variants: StoreVariant[] }[] } | null)?.products?.[0]?.variants ?? [];
  };
  const sellable = (vs: StoreVariant[]) =>
    vs.length > 0 && vs.every((v) => v.manage_inventory === false || (v.inventory_quantity ?? 0) > 0);
  const last = await waitFor(read, sellable, WAIT_MS);
  if (!sellable(last)) {
    throw new Error(
      `Medusa 스토어에서 ${masterId} 가 ${WAIT_MS / 1000}초 안에 판매 가능이 안 됐다: ${JSON.stringify(last)}`,
    );
  }
}
