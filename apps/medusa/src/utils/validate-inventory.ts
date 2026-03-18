import { MedusaError, Modules } from '@medusajs/framework/utils';
import { IInventoryService, IProductModuleService } from '@medusajs/framework/types';

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

export const validateInventoryForItems = async (
  input: ValidateInventoryInput,
  container: any,
) => {
  if (!input.variants?.length) return;

  const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY);
  const productService: IProductModuleService = container.resolve(Modules.PRODUCT);

  const errors: MedusaError[] = [];

  // variant 상세 정보 조회 (manage_inventory, allow_backorder 포함)
  const variantIds = input.variants.map((v) => v.id);
  const variantsWithInventoryInfo = await productService.listProductVariants(
    { id: variantIds },
    { select: ['id', 'manage_inventory', 'allow_backorder', 'title'] },
  );

  const variantMap = new Map(variantsWithInventoryInfo.map((v) => [v.id, v]));

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
        // variant에 연결된 inventory item 조회
        const inventoryItems = await inventoryService.listInventoryItems({
          sku: variant.sku,
        });

        if (!inventoryItems.length) {
          errors.push(
            new MedusaError(
              MedusaError.Types.NOT_ALLOWED,
              `${productName}: 재고 정보가 없습니다`,
            ),
          );
          return;
        }

        const inventoryItem = inventoryItems[0];

        // inventory level 조회
        const levels = await inventoryService.listInventoryLevels({
          inventory_item_id: inventoryItem.id,
        });

        if (!levels.length) {
          errors.push(
            new MedusaError(
              MedusaError.Types.NOT_ALLOWED,
              `${productName}: 재고 정보가 없습니다`,
            ),
          );
          return;
        }

        // 전체 location의 available quantity 합산
        const totalAvailable = levels.reduce((sum, level) => {
          const available = (level.stocked_quantity || 0) - (level.reserved_quantity || 0);
          return sum + available;
        }, 0);

        if (totalAvailable < item.quantity) {
          errors.push(
            new MedusaError(
              MedusaError.Types.NOT_ALLOWED,
              `${productName}: 재고가 부족합니다 (요청: ${item.quantity}, 가능: ${totalAvailable})`,
            ),
          );
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
            new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `${productName}: 재고 확인 중 오류가 발생했습니다`,
            ),
          );
        }
      }
    }),
  );

  if (errors.length > 0) {
    throw errors[0];
  }
};
