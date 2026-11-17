import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { addToCartWorkflow, transferCartCustomerWorkflow } from '@medusajs/medusa/core-flows';
import { defaultStoreCartFields } from '../../../carts/query-config';
import { autoFillShipping } from './auto-fill-shipping';
import { CustomerCartRow, linesToMove, selectCustomerCart } from './select-customer-cart';

async function getCustomerCart(scope: any, customerId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'completed_at', 'updated_at', 'metadata', 'items.id', 'items.variant_id', 'items.quantity', 'items.metadata'],
    filters: { customer_id: customerId },
  });

  const { target, mergeSources } = selectCustomerCart(carts as CustomerCartRow[]);

  if (!target) {
    return null;
  }

  for (const source of mergeSources) {
    await mergeIntoTarget(scope, target, source);
  }

  const { data: full } = await query.graph({
    entity: 'cart',
    fields: ['id', 'customer_id', 'completed_at', 'updated_at', 'metadata', ...defaultStoreCartFields],
    filters: { id: target.id },
  });

  return full[0] ?? null;
}

// 옮긴 카트는 지우지 않고 merged_into 만 찍는다. 원래 라인이 그대로 남아 되돌릴 수 있다.
// 한 줄이라도 못 옮기면 표시하지 않아 다음 복구 때 다시 시도한다. 이미 옮긴 줄은 linesToMove 가 건너뛴다.
// ponytail: 동시 복구 두 건이 같은 카트를 옮기면 수량이 두 배가 될 수 있다. 실제로 보이면 카트 잠금으로.
async function mergeIntoTarget(scope: any, target: CustomerCartRow, source: CustomerCartRow) {
  let allMoved = true;

  for (const line of linesToMove(target, source)) {
    try {
      await addToCartWorkflow(scope).run({
        input: {
          cart_id: target.id,
          items: [{ variant_id: line.variant_id as string, quantity: line.quantity, metadata: line.metadata ?? undefined }],
        },
      });
      target.items = [...(target.items ?? []), line];
    } catch (error) {
      allMoved = false;
      console.error(`[customers/me/cart] merge line ${line.id} from ${source.id} into ${target.id} failed:`, error);
    }
  }

  if (!allMoved) {
    return;
  }

  const cartModule = scope.resolve(Modules.CART);

  await cartModule.updateCarts([{ id: source.id, metadata: { ...(source.metadata ?? {}), merged_into: target.id } }]);
}

/**
 * GET /store/customers/me/cart
 * 로그인한 고객의 미완료 카트를 조회합니다.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  let customerCart = await getCustomerCart(req.scope, customerId);

  if (!customerCart) {
    return res.status(200).json({
      cart: null,
      message: 'No active cart found for this customer',
    });
  }

  // 배송지 및 배송 메모 자동 채우기 (기존 고객 카트 복구 시)
  try {
    await autoFillShipping(req.scope, {
      id: customerCart.id,
      customer_id: customerCart.customer_id,
      shipping_address: customerCart.shipping_address,
      metadata: customerCart.metadata,
    });
    // 업데이트가 있었을 수 있으므로 카트를 다시 조회
    customerCart = await getCustomerCart(req.scope, customerId);
  } catch (error) {
    console.error('[GET /store/customers/me/cart] autoFillShipping failed:', error);
  }

  return res.status(200).json({
    cart: customerCart,
  });
}

/**
 * POST /store/customers/me/cart
 * 고객의 미완료 카트를 복구하고, 게스트 카트 아이템을 병합합니다.
 *
 * Body:
 * - guestCartId?: string - 게스트 카트 ID (전달 시 아이템 병합)
 *
 * 반환:
 * - 병합된 고객 카트 (또는 기존 카트)
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const { guestCartId } = req.body as { guestCartId?: string };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  let customerCart = await getCustomerCart(req.scope, customerId);

  // 게스트 카트 ID가 전달된 경우:
  // 1) 고객 카트가 없으면 게스트 카트를 고객 카트로 이관
  // 2) 고객 카트가 있으면 누락 아이템만 병합
  if (guestCartId) {
    try {
      // 게스트 카트 조회
      const { data: guestCarts } = await query.graph({
        entity: 'cart',
        fields: ['id', 'customer_id', 'items.id', 'items.variant_id', 'items.quantity'],
        filters: {
          id: guestCartId,
          completed_at: null,
        },
      });

      const guestCart = guestCarts?.[0];

      // 이미 고객 카트면 복구 정책(getCustomerCart)이 다룬다. 합쳐진·바로구매·옛 카트를 쿠키 id 로 다시 끌어오지 않게 게스트 카트만 받는다.
      const isGuestCart = Boolean(guestCart?.id) && !guestCart.customer_id;

      if (!customerCart && isGuestCart) {
        await transferCartCustomerWorkflow(req.scope).run({
          input: {
            id: guestCart.id,
            customer_id: customerId,
          },
        });

        customerCart = await getCustomerCart(req.scope, customerId);
      }

      if (customerCart && isGuestCart && customerCart.id !== guestCart.id && guestCart.items?.length > 0) {
        // 고객 카트에 이미 있는 variant_id 목록
        const existingVariantIds = new Set((customerCart.items || []).map((item: any) => item.variant_id));

        // 고객 카트에 없는 게스트 아이템만 필터링
        const itemsToAdd = guestCart.items
          .filter((item: any) => item.variant_id && !existingVariantIds.has(item.variant_id))
          .map((item: any) => ({
            variant_id: item.variant_id,
            quantity: item.quantity || 1,
          }));

        // 병합할 아이템이 있으면 추가
        if (itemsToAdd.length > 0) {
          await addToCartWorkflow(req.scope).run({
            input: {
              cart_id: customerCart.id,
              items: itemsToAdd,
            },
          });

          // 병합 후 카트 다시 조회
          customerCart = await getCustomerCart(req.scope, customerId);
        }
      }
    } catch (error) {
      // 병합 실패해도 기존 고객 카트는 반환
      console.error('Failed to merge guest cart items:', error);
    }
  }

  if (!customerCart) {
    return res.status(200).json({
      cart: null,
      message: 'No active cart found for this customer',
    });
  }

  // 배송지 및 배송 메모 자동 채우기
  try {
    await autoFillShipping(req.scope, {
      id: customerCart.id,
      customer_id: customerCart.customer_id,
      shipping_address: customerCart.shipping_address,
      metadata: customerCart.metadata,
    });
    // 업데이트가 있었을 수 있으므로 카트를 다시 조회
    customerCart = await getCustomerCart(req.scope, customerId);
  } catch (error) {
    console.error('[POST /store/customers/me/cart] autoFillShipping failed:', error);
  }

  return res.status(200).json({
    cart: customerCart,
  });
}
