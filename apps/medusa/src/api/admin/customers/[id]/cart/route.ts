import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { IInventoryService } from '@medusajs/framework/types';

/**
 * GET /admin/customers/:id/cart
 *
 * 회원조회 창의 "장바구니 정보" 탭용. 고객의 최신 active cart(완료 안 된 것) 1개의
 * 라인 아이템을 재고 정보와 함께 반환한다.
 *
 * - 옵션재고(option_stock): 해당 variant 의 available(= stocked - reserved) 합
 * - 총재고량(total_stock): 그 상품의 모든 variant available 합
 * - 품절옵션(sold_out): 재고 관리 대상인데 옵션재고 <= 0
 *
 * 재고 미관리(manage_inventory=false) variant 는 재고 개념이 없어 null 로 둔다.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({ message: 'customerId is required' });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryService: IInventoryService = req.scope.resolve(Modules.INVENTORY);

  // 1) 고객의 active cart 조회 (아이템 있는 것 중 가장 최근 1개)
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'currency_code',
      'created_at',
      'updated_at',
      'items.id',
      'items.created_at',
      'items.quantity',
      'items.unit_price',
      'items.title',
      'items.thumbnail',
      'items.product_id',
      'items.product_title',
      'items.variant_id',
      'items.variant_title',
      'items.variant_sku',
    ],
    filters: {
      customer_id: customerId,
      completed_at: null,
    },
  });

  const activeCart = (carts || [])
    .filter((cart: any) => cart.items?.length > 0)
    .sort((a: any, b: any) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return dateB - dateA;
    })[0];

  if (!activeCart) {
    return res.status(200).json({ cart: null, items: [] });
  }

  const items: any[] = activeCart.items ?? [];
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];

  // 2) 관련 상품의 모든 variant + inventory_item 연결 조회 (총재고량 계산을 위해 전체 variant 필요)
  const { data: variantRows } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'product_id', 'manage_inventory', 'inventory_items.inventory_item_id'],
    filters: { product_id: productIds },
  });

  // variant_id -> inventory_item_id, variant_id -> { productId, managed }
  const variantToInventoryItem = new Map<string, string>();
  const variantMeta = new Map<string, { productId: string; managed: boolean }>();
  const allInventoryItemIds: string[] = [];

  for (const v of variantRows as any[]) {
    variantMeta.set(v.id, {
      productId: v.product_id,
      managed: v.manage_inventory !== false,
    });
    const invItemId = v.inventory_items?.[0]?.inventory_item_id;
    if (invItemId) {
      variantToInventoryItem.set(v.id, invItemId);
      allInventoryItemIds.push(invItemId);
    }
  }

  // 3) inventory level 일괄 조회 후 inventory_item_id 별 available 합산
  const availableByInventoryItem = new Map<string, number>();
  if (allInventoryItemIds.length > 0) {
    const levels = await inventoryService.listInventoryLevels(
      { inventory_item_id: allInventoryItemIds },
      { take: null },
    );
    for (const level of levels as any[]) {
      const available = (level.stocked_quantity || 0) - (level.reserved_quantity || 0);
      const prev = availableByInventoryItem.get(level.inventory_item_id) ?? 0;
      availableByInventoryItem.set(level.inventory_item_id, prev + available);
    }
  }

  // variant_id -> available (재고 미관리는 null)
  const availableByVariant = new Map<string, number | null>();
  for (const [variantId, meta] of variantMeta.entries()) {
    if (!meta.managed) {
      availableByVariant.set(variantId, null);
      continue;
    }
    const invItemId = variantToInventoryItem.get(variantId);
    const available = invItemId ? (availableByInventoryItem.get(invItemId) ?? 0) : 0;
    availableByVariant.set(variantId, available);
  }

  // product_id -> 총재고량 (관리되는 variant available 합. 전부 미관리면 null)
  const totalStockByProduct = new Map<string, number | null>();
  for (const [variantId, meta] of variantMeta.entries()) {
    const available = availableByVariant.get(variantId);
    const prev = totalStockByProduct.get(meta.productId);
    if (available == null) {
      if (prev === undefined) totalStockByProduct.set(meta.productId, null);
      continue;
    }
    totalStockByProduct.set(meta.productId, (prev ?? 0) + available);
  }

  // 4) 응답 매핑
  const responseItems = items.map((item) => {
    const optionStock = availableByVariant.get(item.variant_id) ?? null;
    const totalStock = totalStockByProduct.get(item.product_id) ?? null;
    const manageInventory = variantMeta.get(item.variant_id)?.managed ?? null;
    return {
      id: item.id,
      created_at: item.created_at,
      quantity: item.quantity,
      unit_price: item.unit_price,
      product_id: item.product_id,
      product_title: item.product_title ?? item.title ?? null,
      thumbnail: item.thumbnail ?? null,
      variant_id: item.variant_id,
      variant_title: item.variant_title ?? null,
      variant_sku: item.variant_sku ?? null,
      manage_inventory: manageInventory,
      option_stock: optionStock,
      total_stock: totalStock,
      sold_out: optionStock != null && optionStock <= 0,
    };
  });

  return res.status(200).json({
    cart: {
      id: activeCart.id,
      currency_code: activeCart.currency_code,
      created_at: activeCart.created_at,
      updated_at: activeCart.updated_at,
    },
    items: responseItems,
  });
}
