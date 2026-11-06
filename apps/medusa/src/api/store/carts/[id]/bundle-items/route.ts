import { MedusaRequest, MedusaResponse, prepareRetrieveQuery } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { addToCartWorkflow, updateTaxLinesWorkflow } from '@medusajs/medusa/core-flows';
import { BUNDLE_OFFER_MODULE } from '../../../../../modules/bundle-offer';
import type BundleOfferModuleService from '../../../../../modules/bundle-offer/service';
import type { BundleLineMetadata } from '../../../../../utils/bundle-reconcile';
import { buildPricingContext } from '../../../../../utils/pricing-context';
import { refetchCart } from '../../helpers';
import { defaultStoreCartFields } from '../../query-config';
import type { StoreAddBundleItemsBody } from './validators';

/**
 * POST /store/carts/:id/bundle-items — 상세의 «함께 쓰면 좋은 구성»에서 고른 구성품을 담는다.
 *
 * 여기서는 구성품이 이 상품의 구성품인지만 확인하고, 담은 라인에 부모 상품을 표시해 지금 가격으로 넣는다.
 * 할인 단가·한도(부모 수량까지)·초과분 분리는 같은 담기 안의 카트 재판정(refresh 훅)이 정한다 — 담기와
 * 나중의 수량 수정·삭제가 같은 계산을 탄다. 회원 여부도 서버가 고객 그룹으로 본다.
 */
export const POST = async (req: MedusaRequest<StoreAddBundleItemsBody>, res: MedusaResponse) => {
  const cartId = req.params.id;
  const { parent_line_id, items } = req.validatedBody;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const {
    data: [cart],
  } = await query.graph({
    entity: 'cart',
    fields: ['id', 'currency_code', 'region_id', 'customer.groups.id', 'items.id', 'items.product_id'],
    filters: { id: cartId },
  });
  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`);
  const parent = (cart.items ?? []).find((i: { id: string }) => i.id === parent_line_id);
  if (!parent?.product_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, '함께 담을 상품이 장바구니에 없습니다.');

  const { data: variants } = await query.graph({
    entity: 'variant',
    fields: ['id', 'product_id', 'price_set.id'],
    filters: { id: items.map((i) => i.variant_id) },
  });
  const offers = await req.scope
    .resolve<BundleOfferModuleService>(BUNDLE_OFFER_MODULE)
    .listBundleOffers({ product_id: parent.product_id, enabled: true });

  for (const item of items) {
    const variant = variants.find((v: { id: string }) => v.id === item.variant_id);
    const offer = variant && offers.find((o) => o.addon_product_id === variant.product_id);
    const allowed = offer && (!offer.allowed_variant_ids || offer.allowed_variant_ids.includes(item.variant_id));
    if (!allowed) throw new MedusaError(MedusaError.Types.INVALID_DATA, '이 상품과 함께 담을 수 있는 구성품이 아닙니다.');
  }

  // 시작 단가 = 그 고객의 지금 가격. 재판정이 할인가로 바꾸고, 자격이 없으면 이 가격 그대로 일반 라인이 된다.
  const pricing = req.scope.resolve(Modules.PRICING);
  const context = buildPricingContext({
    currencyCode: cart.currency_code,
    regionId: cart.region_id ?? undefined,
    customerGroupIds: (cart.customer?.groups ?? []).map((g: { id: string }) => g.id),
  });
  const metadata: { bundle: BundleLineMetadata } = { bundle: { offer_product_id: parent.product_id } };
  const toAdd: Array<{ variant_id: string; quantity: number; unit_price: number; metadata: { bundle: BundleLineMetadata } }> = [];
  for (const item of items) {
    const priceSetId = variants.find((v: { id: string }) => v.id === item.variant_id)?.price_set?.id;
    const [price] = priceSetId
      ? await pricing.calculatePrices({ id: [priceSetId] }, { context: { ...context, quantity: item.quantity } })
      : [];
    if (price?.calculated_amount == null) throw new MedusaError(MedusaError.Types.INVALID_DATA, '가격이 없는 옵션입니다.');
    toAdd.push({ variant_id: item.variant_id, quantity: item.quantity, unit_price: Number(price.calculated_amount), metadata });
  }

  await addToCartWorkflow(req.scope).run({ input: { cart_id: cartId, items: toAdd } });
  // 같은 담기의 재판정이 한도를 넘는 수량을 새 일반 라인으로 나눌 수 있다. 담기의 세금 계산은 요청한 라인만 보므로
  // 잠금이 풀린 뒤 카트 세금을 한 번 다시 매긴다(번들 담기 요청에만 드는 비용).
  await updateTaxLinesWorkflow(req.scope).run({ input: { cart_id: cartId } });

  const fields = (
    await prepareRetrieveQuery({}, { defaults: [...defaultStoreCartFields, 'items.is_custom_price', 'items.compare_at_unit_price'] })
  ).remoteQueryConfig.fields;
  res.status(200).json({ cart: await refetchCart(cartId, req.scope, fields) });
};
