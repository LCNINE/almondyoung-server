import { MedusaError, Modules } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { ICartModuleService } from '@medusajs/framework/types';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../api/admin/promotions/helpers';
import { isOverseasProduct, type MembershipProduct } from '../../../utils/membership-filter';
// import { getInventoryValidationFailures } from '../../../utils/validate-inventory';

const PERSONAL_CUSTOMS_CODE_PATTERN = /^[A-Za-z]\d{12}$/;
const WELCOME_MEMBERSHIP_TAG = 'welcome-membership';

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

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
          throw new MedusaError(MedusaError.Types.INVALID_DATA, '이 쿠폰은 발급된 고객만 사용할 수 있습니다.');
        }
        const { data: customers } = await query.graph({
          entity: 'customer',
          fields: ['id', 'promotions.id'],
          filters: { id: cart.customer_id },
        });
        const isAssigned = (customers?.[0]?.promotions ?? []).some((p: any) => p.id === promo.id);
        if (!isAssigned) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, '이 쿠폰은 발급된 고객만 사용할 수 있습니다.');
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

  // 해외직구 상품 통관부호 검증 — 주문 완료 직전 최종 방어
  const { data: cartsWithItems } = await query.graph({
    entity: 'cart',
    fields: ['id', 'shipping_address.metadata', 'items.variant.product.metadata', 'items.variant.product.tags.value'],
    filters: { id: cart.id },
  });

  const fullCart = cartsWithItems?.[0] as any;
  const cartItems: Array<{
    variant?: { product?: (MembershipProduct & { tags?: Array<{ value?: string }> }) | null } | null;
  }> = fullCart?.items ?? [];

  const hasOverseasProduct = cartItems.some((item) => {
    const product = item?.variant?.product;
    return product ? isOverseasProduct(product as MembershipProduct) : false;
  });

  if (hasOverseasProduct) {
    const personalCustomsCode = (fullCart?.shipping_address?.metadata as Record<string, unknown> | null)
      ?.personalCustomsCode;
    const code = typeof personalCustomsCode === 'string' ? personalCustomsCode.trim() : '';

    if (!code) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        '해외직구 상품이 포함되어 있어 개인통관고유부호가 필요합니다.',
      );
    }

    if (!PERSONAL_CUSTOMS_CODE_PATTERN.test(code)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        '해외직구 상품이 포함되어 있어 개인통관고유부호가 필요합니다.',
      );
    }
  }

  // ── 웰컴 멤버십: 유저당 평생 1개 (진행 중 주문 포함) 최종 방어 ──
  // addToCart hook 은 "장바구니당 1개"만 막는다. 무통장입금처럼 결제확정(capture) 전에는
  // has_purchased 가 아직 false 라, 장바구니를 새로 만들어 주문을 반복하면 add 단계
  // 자격검증을 통과해버린다. 주문 생성 직전에 "이미 취소되지 않은 웰컴 주문이 있는가"를
  // 직접 확인해 그 갭을 닫는다. 취소/만료 주문은 canceled_at 로 자동 제외되어 재구매가
  // 가능하다
  const cartHasWelcome = cartItems.some((item) =>
    (item?.variant?.product?.tags ?? []).some((tag) => tag?.value === WELCOME_MEMBERSHIP_TAG),
  );

  if (cartHasWelcome && cart.customer_id) {
    const { data: welcomeTags } = await query.graph({
      entity: 'product_tag',
      fields: ['id', 'products.id'],
      filters: { value: WELCOME_MEMBERSHIP_TAG },
    });
    const welcomeProductIds = new Set<string>(
      (welcomeTags ?? []).flatMap((t: any) => (t.products ?? []).map((p: any) => p.id as string)),
    );

    // 고객별 주문 전체 스캔. 웰컴 카트일 때만 타므로 대부분의 주문엔 영향 없음.
    // 주문 이력이 수백 건인 고객이 웰컴을 담는 극단 케이스에서만 느려질 수 있음.
    const { data: customerOrders } = await query.graph({
      entity: 'order',
      fields: ['id', 'canceled_at', 'items.product_id'],
      filters: { customer_id: cart.customer_id },
    });

    const hasOpenWelcomeOrder = (customerOrders ?? []).some(
      (order: any) =>
        !order.canceled_at && (order.items ?? []).some((item: any) => welcomeProductIds.has(item.product_id)),
    );

    if (hasOpenWelcomeOrder) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        '이미 웰컴 멤버십 상품을 주문하셨습니다. 웰컴 상품은 1인당 1개만 구매 가능합니다.',
      );
    }
  }

  // TEMP: 재고 부족 주문 차단을 주문 완료 플로우에서 임시 비활성화.
  // const { data: carts } = await query.graph(
  //   {
  //     entity: 'cart',
  //     fields: [
  //       'id',
  //       'region_id',
  //       'sales_channel_id',
  //       'items.id',
  //       'items.quantity',
  //       'items.title',
  //       'items.variant.id',
  //       'items.variant.title',
  //       'items.variant.manage_inventory',
  //       'items.variant.allow_backorder',
  //       'items.variant.product.id',
  //       'items.variant.product.title',
  //     ],
  //     filters: {
  //       id: cart.id,
  //     },
  //   },
  //   {
  //     throwIfKeyNotFound: true,
  //   },
  // );
  //
  // const fullCart = carts[0];
  //
  // // 카트가 없거나 아이템이 없으면 통과
  // if (!fullCart || !fullCart.items?.length) {
  //   return;
  // }
  //
  // const items = fullCart.items;
  //
  // const inventoryItems = items
  //   .map((item: any) => ({
  //     variant_id: item?.variant?.id,
  //     quantity: item?.quantity,
  //   }))
  //   .filter((item: any) => item.variant_id && item.quantity > 0);
  //
  // const variants = items
  //   .map((item: any) => item?.variant)
  //   .filter(Boolean)
  //   .map((variant: any) => ({
  //     id: variant.id,
  //     manage_inventory: variant.manage_inventory,
  //     allow_backorder: variant.allow_backorder,
  //     product: variant.product ? { title: variant.product.title } : null,
  //   }));
  //
  // if (!inventoryItems.length || !variants.length) {
  //   return;
  // }
  //
  // const outOfStockItems = await getInventoryValidationFailures(
  //   {
  //     items: inventoryItems,
  //     variants,
  //   },
  //   container,
  // );
  //
  // // 재고 부족 상품이 있으면 에러 메시지 + 프론트용 payload(variant_ids)로 MedusaError 던지기
  // if (outOfStockItems.length) {
  //   const titles = outOfStockItems.map((i) => i.title).filter(Boolean);
  //   const userMessage =
  //     titles.length === 1
  //       ? `${titles[0]} 상품의 재고가 부족합니다. 상품을 다시 확인해주세요.`
  //       : `${titles.join(', ')} 상품들의 재고가 부족합니다. 상품을 다시 확인해주세요.`;
  //
  //   // API 응답에는 code/type/message만 나가므로, 프론트에서 variant_id로 정확히 식별할 수 있게 message 끝에 JSON 붙임
  //   const payload = {
  //     out_of_stock_variant_ids: outOfStockItems.map((i) => i.variant_id),
  //     out_of_stock_titles: titles,
  //   };
  //   const msg = `${userMessage}\n${JSON.stringify(payload)}`;
  //
  //   throw new MedusaError(MedusaError.Types.INVALID_DATA, msg);
  // }
  //
  // // 재고 부족이 없으면 통과
});
