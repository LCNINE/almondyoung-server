import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { BUNDLE_OFFER_MODULE } from '../modules/bundle-offer';
import type BundleOfferModuleService from '../modules/bundle-offer/service';
import { buildPricingContext } from './pricing-context';
import { calculatePricesByQuantity, priceKey as quantityPriceKey } from './prices-by-quantity';
import {
  planBundleLines,
  priceKey,
  releasedLineUpdate,
  type BundleCartLine,
  type BundleLineChange,
  type BundleOfferView,
  type BundleRates,
  type PriceBasis,
} from './bundle-lines';

/**
 * 위젯으로 담은 라인의 표시. 담을 때는 부모 상품(A)만 적고, 재판정이 그 단가를 정한 할인율을 더한다.
 * 가격·자격은 매번 처음부터 다시 계산한다 — 이 값을 믿지 않는다(할인율은 주문 뒤 멤버십 혜택 계산용 기록).
 */
export type BundleLineMetadata = { offer_product_id: string; regular_rate_bp?: number; membership_rate_bp?: number };

const MAX_PRICE_ROUNDS = 3;

const bundleRates = (metadata: unknown): BundleRates | null => {
  const bundle = (metadata as { bundle?: Partial<BundleLineMetadata> } | null)?.bundle;
  return typeof bundle?.regular_rate_bp === 'number' && typeof bundle?.membership_rate_bp === 'number'
    ? { regular_rate_bp: bundle.regular_rate_bp, membership_rate_bp: bundle.membership_rate_bp }
    : null;
};

const hasBundleMarker = (metadata: unknown): boolean => Boolean((metadata as { bundle?: unknown } | null)?.bundle);

const bundleParent = (metadata: unknown): string | null => {
  const bundle = (metadata as { bundle?: Partial<BundleLineMetadata> } | null)?.bundle;
  return typeof bundle?.offer_product_id === 'string' ? bundle.offer_product_id : null;
};

type CartItemRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  compare_at_unit_price: number | null;
  is_custom_price: boolean;
  created_at: string | Date;
  metadata: Record<string, unknown> | null;
};

/**
 * 카트의 함께 구매 라인을 지금 카트 상태에 맞춘다. 번들 라인이 없으면 조회 한 번으로 끝난다.
 * 카트 refresh 의 가격·프로모션 계산 앞에서 불린다 — 여기서 바꾼 단가로 쿠폰이 계산된다.
 */
export type BundleReconcileUndo = { restore: Array<Record<string, unknown> & { id: string }>; created: string[] };

export async function reconcileBundleLines(
  container: MedusaContainer,
  cartId: string,
  now = new Date(),
): Promise<{ changes: BundleLineChange[]; undo: BundleReconcileUndo }> {
  const none = { changes: [], undo: { restore: [], created: [] } };
  const cartModule = container.resolve(Modules.CART);
  // 커스텀 단가는 함께 구매 담기만 만든다. 표시가 지워진 커스텀 단가 라인도 여기서 일반가로 돌린다.
  const current = await cartModule.listLineItems({ cart_id: cartId }, { select: ['id', 'is_custom_price', 'metadata'] });
  if (!current.some((l) => l.is_custom_price || hasBundleMarker(l.metadata))) return none;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const {
    data: [cart],
  } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'currency_code',
      'region_id',
      'customer_id',
      'items.id',
      'items.product_id',
      'items.variant_id',
      'items.quantity',
      'items.unit_price',
      'items.compare_at_unit_price',
      'items.is_custom_price',
      'items.created_at',
      'items.metadata',
    ],
    filters: { id: cartId },
  });
  if (!cart) return none;

  const items = ((cart.items ?? []) as CartItemRow[]).filter((i) => i.product_id && i.variant_id);
  const lines: BundleCartLine[] = items.map((i) => ({
    id: i.id,
    product_id: i.product_id as string,
    variant_id: i.variant_id as string,
    quantity: Number(i.quantity),
    unit_price: Number(i.unit_price),
    compare_at_unit_price: i.compare_at_unit_price == null ? null : Number(i.compare_at_unit_price),
    is_custom_price: Boolean(i.is_custom_price),
    created_at: new Date(i.created_at),
    bundle_parent_product_id: i.is_custom_price ? bundleParent(i.metadata) : null,
    bundle_rates: bundleRates(i.metadata),
    has_bundle_marker: hasBundleMarker(i.metadata),
  }));
  const bundleLines = lines.filter((l) => l.bundle_parent_product_id);
  const parentIds = [...new Set(bundleLines.map((l) => l.bundle_parent_product_id as string))];
  // 표시가 지워진 커스텀 단가 라인도 일반가로 돌려야 하므로 가격을 함께 읽는다
  const addonVariantIds = [...new Set(lines.filter((l) => l.is_custom_price || l.has_bundle_marker).map((l) => l.variant_id))];

  const offerService = container.resolve<BundleOfferModuleService>(BUNDLE_OFFER_MODULE);
  const offers: BundleOfferView[] = (await offerService.listBundleOffers({ product_id: parentIds })).map((o) => ({
    product_id: o.product_id,
    addon_product_id: o.addon_product_id,
    allowed_variant_ids: o.allowed_variant_ids ?? null,
    regular_rate_bp: o.regular_rate_bp,
    membership_rate_bp: o.membership_rate_bp,
    enabled: o.enabled,
    starts_at: o.starts_at ? new Date(o.starts_at) : null,
    ends_at: o.ends_at ? new Date(o.ends_at) : null,
  }));

  const productIds = [...new Set([...parentIds, ...bundleLines.map((l) => l.product_id)])];
  const { data: products } = await query.graph({ entity: 'product', fields: ['id', 'status'], filters: { id: productIds } });
  const sellableProducts = new Set((products as Array<{ id: string; status: string }>).filter((p) => p.status === 'published').map((p) => p.id));

  const customerGroupIds = await customerGroups(container, cart.customer_id ?? null);
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  const isMember = Boolean(membershipGroupId && customerGroupIds.includes(membershipGroupId));

  const { data: variants } = await query.graph({
    entity: 'variant',
    fields: ['id', 'metadata', 'price_set.id'],
    filters: { id: addonVariantIds },
  });
  const priceSetByVariant = new Map<string, string>();
  const membershipByVariant = new Map<string, number | null>();
  for (const v of variants as Array<{ id: string; metadata?: Record<string, unknown> | null; price_set?: { id: string } | null }>) {
    if (v.price_set?.id) priceSetByVariant.set(v.id, v.price_set.id);
    const m = Number(v.metadata?.membershipPrice);
    membershipByVariant.set(v.id, Number.isFinite(m) && m > 0 ? m : null);
  }

  const pricing = container.resolve(Modules.PRICING);
  const guestContext = buildPricingContext({ currencyCode: cart.currency_code, regionId: cart.region_id ?? undefined, customerGroupIds: [] });
  const customerContext = buildPricingContext({ currencyCode: cart.currency_code, regionId: cart.region_id ?? undefined, customerGroupIds });

  // 정가 = 비회원 수량 1 의 원래 가격(가격표 할인 전)
  const guestPrices = await calculatePricesByQuantity(
    pricing,
    [...priceSetByVariant.values()].map((priceSetId) => ({ priceSetId, quantity: 1 })),
    guestContext,
  );
  const basis = new Map<string, PriceBasis>();
  for (const [variantId, priceSetId] of priceSetByVariant) {
    const guest = guestPrices.get(quantityPriceKey(1, priceSetId));
    if (guest) basis.set(variantId, { regular: guest.original, membership: membershipByVariant.get(variantId) ?? null });
  }

  const priceAt = new Map<string, number>();
  const compareAt = new Map<string, number>();
  let plan = planBundleLines(lines, { offers, sellableProducts, isMember, now, basis, priceAt, compareAt });
  for (let round = 0; round < MAX_PRICE_ROUNDS && plan.missingPrices.length > 0; round++) {
    const requests = plan.missingPrices.flatMap(({ variant_id, quantity }) => {
      const priceSetId = priceSetByVariant.get(variant_id);
      return priceSetId ? [{ priceSetId, quantity, variant_id }] : [];
    });
    const fetched = await calculatePricesByQuantity(pricing, requests, customerContext);
    for (const r of requests) {
      const p = fetched.get(quantityPriceKey(r.quantity, r.priceSetId));
      if (!p) continue;
      priceAt.set(priceKey(r.variant_id, r.quantity), p.calculated);
      if (p.sale && p.original !== p.calculated) compareAt.set(priceKey(r.variant_id, r.quantity), p.original);
    }
    plan = planBundleLines(lines, { offers, sellableProducts, isMember, now, basis, priceAt, compareAt });
  }

  const undo: BundleReconcileUndo = { restore: [], created: [] };
  try {
    await applyChanges(cartModule, cartId, items, plan.changes, now, undo);
  } catch (error) {
    // 반쯤 적용된 채 실패하면 훅 보상이 입력을 못 받는다 — 여기서 되돌리고 다시 던진다
    await undoBundleReconcile(container, undo);
    throw error;
  }
  return { changes: plan.changes, undo };
}

/** 재판정 뒤 refresh 의 다음 단계가 실패하면 바꾼 라인을 되돌린다(훅 보상). */
export async function undoBundleReconcile(container: MedusaContainer, undo: BundleReconcileUndo): Promise<void> {
  const cart = container.resolve(Modules.CART) as unknown as CartModule;
  if (undo.created.length > 0) await cart.deleteLineItems(undo.created);
  for (const { id, ...fields } of undo.restore) await cart.updateLineItems(id, fields);
}

async function customerGroups(container: MedusaContainer, customerId: string | null): Promise<string[]> {
  if (!customerId) return [];
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const {
    data: [customer],
  } = await query.graph({ entity: 'customer', fields: ['id', 'groups.id'], filters: { id: customerId } });
  return ((customer?.groups ?? []) as Array<{ id: string }>).map((g) => g.id);
}

type CartModule = ReturnType<MedusaContainer['resolve']> & {
  updateLineItems: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  addLineItems: (data: Record<string, unknown>) => Promise<Array<{ id: string }> | { id: string }>;
  deleteLineItems: (ids: string[]) => Promise<unknown>;
  retrieveLineItem: (id: string, config?: { relations?: string[] }) => Promise<Record<string, unknown>>;
};

type TaxLineRow = { description?: string | null; tax_rate_id?: string | null; code: string; rate: number; provider_id?: string | null };
/**
 * 같은 옵션 원 라인의 세금 라인. refresh 는 이번 조작의 라인만 세금을 매기므로 재판정이 새로 만든 라인은 원 라인 것을 옮긴다.
 * 원 라인이 막 담겨 아직 세금 라인이 없을 때(첫 담기)는 담기 라우트가 담기 뒤 카트 세금을 다시 매긴다.
 */
const copyTaxLines = (rows: unknown) =>
  ((rows ?? []) as TaxLineRow[]).map((t) => ({
    code: t.code,
    rate: Number(t.rate),
    ...(t.description ? { description: t.description } : {}),
    ...(t.tax_rate_id ? { tax_rate_id: t.tax_rate_id } : {}),
    ...(t.provider_id ? { provider_id: t.provider_id } : {}),
  }));

const COPIED_LINE_FIELDS = [
  'title',
  'subtitle',
  'thumbnail',
  'product_id',
  'product_title',
  'product_description',
  'product_subtitle',
  'product_type',
  'product_type_id',
  'product_collection',
  'product_handle',
  'variant_id',
  'variant_sku',
  'variant_barcode',
  'variant_title',
  'variant_option_values',
  'requires_shipping',
  'is_discountable',
  'is_giftcard',
  'is_tax_inclusive',
] as const;

async function applyChanges(
  cartModule: unknown,
  cartId: string,
  items: CartItemRow[],
  changes: BundleLineChange[],
  now: Date,
  undo: BundleReconcileUndo,
): Promise<void> {
  const cart = cartModule as CartModule;
  const metadataOf = (id: string) => items.find((i) => i.id === id)?.metadata ?? {};
  const remember = (id: string) => {
    const before = items.find((i) => i.id === id);
    if (!before || undo.restore.some((r) => r.id === id)) return;
    const metadata = { ...(before.metadata ?? {}) };
    // 합치기 규칙이라 원래 없던 키는 빈 문자열로 지운다
    if (!('bundle' in metadata)) metadata.bundle = '';
    if (!('bundle_released' in metadata)) metadata.bundle_released = '';
    undo.restore.push({
      id,
      quantity: before.quantity,
      unit_price: before.unit_price,
      compare_at_unit_price: before.compare_at_unit_price,
      is_custom_price: before.is_custom_price,
      metadata,
    });
  };
  for (const change of changes) {
    remember(change.type === 'move_overflow' ? change.from_line_id : change.line_id);
    if (change.type === 'move_overflow' && change.into_line_id) remember(change.into_line_id);
    if (change.type === 'set_bundle') {
      const metadata = metadataOf(change.line_id) as Record<string, unknown> & { bundle?: BundleLineMetadata };
      await cart.updateLineItems(change.line_id, {
        quantity: change.quantity,
        unit_price: change.unit_price,
        compare_at_unit_price: change.compare_at_unit_price,
        is_custom_price: true,
        metadata: {
          ...metadata,
          bundle: { ...metadata.bundle, regular_rate_bp: change.regular_rate_bp, membership_rate_bp: change.membership_rate_bp },
        },
      });
    } else if (change.type === 'release') {
      await cart.updateLineItems(change.line_id, releasedLineUpdate(change, now));
    } else if (change.into_line_id) {
      await cart.updateLineItems(change.into_line_id, {
        quantity: change.into_quantity,
        unit_price: change.unit_price,
        compare_at_unit_price: change.compare_at_unit_price,
      });
    } else {
      const source = await cart.retrieveLineItem(change.from_line_id, { relations: ['tax_lines'] });
      const copied = Object.fromEntries(COPIED_LINE_FIELDS.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
      const created = await cart.addLineItems({
        ...copied,
        cart_id: cartId,
        quantity: change.quantity,
        unit_price: change.unit_price,
        compare_at_unit_price: change.compare_at_unit_price,
        is_custom_price: false,
        tax_lines: copyTaxLines(source.tax_lines),
      });
      undo.created.push(...(Array.isArray(created) ? created : [created]).map((l) => l.id));
    }
  }
}
