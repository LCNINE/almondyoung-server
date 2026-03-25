import { MedusaError } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { getVariantAvailability, ContainerRegistrationKeys } from '@medusajs/framework/utils';

// getVariantAvailability의 첫 번째 인자 타입 추론 (패키지 간 타입 충돌 방지)
type QueryParam = Parameters<typeof getVariantAvailability>[0];

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve<QueryParam>(ContainerRegistrationKeys.QUERY);

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
