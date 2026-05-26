import { MedusaError, Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { IInventoryService, IProductModuleService } from '@medusajs/framework/types';
import { isMedusaProductSellableInventoryItem } from './medusa-inventory-projection';

export type ValidateInventoryInput = {
  items: {
    variant_id: string;
    quantity: number;
  }[];
  variants: {
    id: string;
    sku?: string | null;
    manage_inventory?: boolean;
    allow_backorder?: boolean;
    product?: {
      title: string;
    } | null;
  }[];
};

export const validateInventoryForItems = async (input: ValidateInventoryInput, container: any) => {
  if (!input.variants?.length) return;

  const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY);
  const productService: IProductModuleService = container.resolve(Modules.PRODUCT);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const errors: MedusaError[] = [];

  // variant 상세 정보 조회 (manage_inventory, allow_backorder 포함)
  const variantIds = input.variants.map((v) => v.id);
  const variantsWithInventoryInfo = await productService.listProductVariants(
    { id: variantIds },
    { select: ['id', 'manage_inventory', 'allow_backorder', 'title'] },
  );

  const variantMap = new Map(variantsWithInventoryInfo.map((v) => [v.id, v]));

  // Query로 variant -> inventory_item 연결 조회
  const { data: variantInventoryData } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'inventory_items.*', 'inventory_items.inventory.sku', 'inventory_items.inventory.metadata'],
    filters: {
      id: variantIds,
    },
  });

  // variant_id -> inventory_item_id 매핑
  const variantToInventoryMap = new Map<string, string>();
  for (const variantData of variantInventoryData) {
    if (variantData.inventory_items?.length) {
      const projectionInventoryItem =
        variantData.inventory_items.find((item: any) => isMedusaProductSellableInventoryItem(item.inventory)) ??
        variantData.inventory_items[0];
      variantToInventoryMap.set(variantData.id, projectionInventoryItem.inventory_item_id);
    }
  }

  await Promise.all(
    input.variants.map(async (variant) => {
      const item = input.items.find((i) => i.variant_id === variant.id);
      if (!item) return;

      const variantInfo = variantMap.get(variant.id);
      const productName = variant.product?.title || variantInfo?.title || variant.id;

      // manage_inventory가 false면 재고 체크 스킵
      if (!variantInfo?.manage_inventory) {
        return;
      }

      // allow_backorder가 true면 재고 체크 스킵
      if (variantInfo?.allow_backorder) {
        return;
      }

      try {
        // variant에 연결된 inventory_item_id 조회
        const inventoryItemId = variantToInventoryMap.get(variant.id);

        if (!inventoryItemId) {
          errors.push(new MedusaError(MedusaError.Types.NOT_ALLOWED, `${productName}: 재고 정보가 없습니다`));
          return;
        }

        // inventory level 조회
        const levels = await inventoryService.listInventoryLevels({
          inventory_item_id: inventoryItemId,
        });

        if (!levels.length) {
          errors.push(new MedusaError(MedusaError.Types.NOT_ALLOWED, `${productName}: 재고 정보가 없습니다`));
          return;
        }

        // 전체 location의 available quantity 합산
        const totalAvailable = levels.reduce((sum, level) => {
          const available = (level.stocked_quantity || 0) - (level.reserved_quantity || 0);
          return sum + available;
        }, 0);

        if (totalAvailable < item.quantity) {
          const message =
            totalAvailable === 0
              ? `${productName}: 품절된 상품입니다.`
              : `${productName}: 최대 ${totalAvailable}개까지 구매 가능합니다.`;
          errors.push(new MedusaError(MedusaError.Types.NOT_ALLOWED, message));
        }
      } catch (error: any) {
        console.error('[validate-inventory] 에러:', {
          variantId: variant.id,
          productName,
          error: error.message,
        });

        if (error instanceof MedusaError) {
          errors.push(error);
        } else {
          errors.push(
            new MedusaError(MedusaError.Types.INVALID_DATA, `${productName}: 재고 확인 중 오류가 발생했습니다`),
          );
        }
      }
    }),
  );

  if (errors.length > 0) {
    throw errors[0];
  }
};
