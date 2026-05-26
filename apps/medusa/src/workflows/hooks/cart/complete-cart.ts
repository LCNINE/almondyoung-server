import { MedusaError, Modules } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { getVariantAvailability, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { ICartModuleService } from '@medusajs/framework/types';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../api/admin/promotions/helpers';

type QueryParam = Parameters<typeof getVariantAvailability>[0];

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve<QueryParam>(ContainerRegistrationKeys.QUERY);

  // 쿠폰 정책 재검증 — cart-add 이후 주문 완료 사이 race window 차단
  // promotions relation은 validate hook 인자에 보장되지 않으므로 cart.id로 명시 재조회
  const { data: cartsWithPromos } = await query.graph({
    entity: 'cart',
    fields: ['id', 'promotions.id'],
    filters: { id: cart.id },
  });
  const cartPromos: Array<{ id: string }> = (cartsWithPromos?.[0] as any)?.promotions ?? [];

  if (cartPromos.length) {
    const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

    for (const promo of cartPromos) {
      const meta = await promotionMetaService.getByPromotionId(promo.id);
      const metaShape = toMetadataShape(meta);

      if (metaShape?.visibility === 'assigned_only' || metaShape?.visibility === 'claimable') {
        if (!cart.customer_id) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            '이 쿠폰은 발급된 고객만 사용할 수 있습니다.',
          );
        }
        const { data: customers } = await query.graph({
          entity: 'customer',
          fields: ['id', 'promotions.id'],
          filters: { id: cart.customer_id },
        });
        const isAssigned = (customers?.[0]?.promotions ?? []).some((p: any) => p.id === promo.id);
        if (!isAssigned) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            '이 쿠폰은 발급된 고객만 사용할 수 있습니다.',
          );
        }
      }

    }
  }

  // cart.email이 없고 customer_id가 있으면 customer.email로 자동 채우기
  if (!cart.email && cart.customer_id) {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'email'],
      filters: { id: cart.customer_id },
    });

    const customer = customers?.[0];

    if (customer?.email) {
      const cartService = container.resolve<ICartModuleService>(Modules.CART);
      await cartService.updateCarts(cart.id, { email: customer.email });
      // cart 객체도 업데이트 (이후 로직에서 사용될 수 있으므로)
      cart.email = customer.email;
    }
  }

  const { data: carts } = await query.graph(
    {
      entity: 'cart',
      fields: [
        'id',
        'region_id',
        'sales_channel_id',
        'items.id',
        'items.quantity',
        'items.title',
        'items.variant.id',
        'items.variant.title',
        'items.variant.manage_inventory',
        'items.variant.product.id',
        'items.variant.product.title',
      ],
      filters: {
        id: cart.id,
      },
    },
    {
      throwIfKeyNotFound: true,
    },
  );

  const fullCart = carts[0];

  // 카트가 없거나 아이템이 없으면 통과
  if (!fullCart || !fullCart.items?.length) {
    return;
  }

  const items = fullCart.items;

  // 이 카트가 속한 sales_channel_id 를 사용해 재고 조회에 쓸 채널 결정
  const salesChannelId = fullCart.sales_channel_id;
  if (!salesChannelId) {
    // 세일즈 채널이 없으면 여기서는 별도 검증을 하지 않고 통과
    return;
  }

  const variantIds = items.map((i: any) => i.variant?.id).filter(Boolean) as string[];

  if (!variantIds.length) {
    return;
  }

  const availability = await getVariantAvailability(query, {
    variant_ids: variantIds,
    sales_channel_id: salesChannelId,
  });

  // 카트 수량 > 재고 수량 인 아이템들만 골라서 variant_id + 상품명 수집 (manage_inventory=true 인 variant만 검사)
  const outOfStockItems: { variant_id: string; title: string }[] = [];

  for (const item of items) {
    const variantId = item?.variant?.id;
    if (!variantId) {
      continue;
    }

    // 재고 관리가 꺼진 variant는 항상 재고 있음으로 간주 → 검사 스킵
    const manageInventory = item.variant?.manage_inventory;
    if (manageInventory === false) {
      continue;
    }

    const variantAvailability = availability[variantId];
    // manage_inventory=true 인 경우에만: 카트 수량이 가용 재고를 초과하면 재고 부족으로 처리
    if (variantAvailability && (variantAvailability.availability ?? 0) < item.quantity) {
      const title = item.variant?.product?.title ?? item.variant?.title ?? item.title ?? '';

      outOfStockItems.push({ variant_id: variantId, title });
    }
  }

  // 재고 부족 상품이 있으면 에러 메시지 + 프론트용 payload(variant_ids)로 MedusaError 던지기
  if (outOfStockItems.length) {
    const titles = outOfStockItems.map((i) => i.title).filter(Boolean);
    const userMessage =
      titles.length === 1
        ? `${titles[0]} 상품의 재고가 부족합니다. 상품을 다시 확인해주세요.`
        : `${titles.join(', ')} 상품들의 재고가 부족합니다. 상품을 다시 확인해주세요.`;

    // API 응답에는 code/type/message만 나가므로, 프론트에서 variant_id로 정확히 식별할 수 있게 message 끝에 JSON 붙임
    const payload = {
      out_of_stock_variant_ids: outOfStockItems.map((i) => i.variant_id),
      out_of_stock_titles: titles,
    };
    const msg = `${userMessage}\n${JSON.stringify(payload)}`;

    throw new MedusaError(MedusaError.Types.INVALID_DATA, msg);
  }

  // 재고 부족이 없으면 통과
});
