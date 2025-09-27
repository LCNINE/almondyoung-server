import { MedusaError } from '@medusajs/framework/utils';
import { WMS_MODULE } from '@modules/wms';
import { WmsModuleService } from '@modules/wms/service';

export type ValidateInventoryInput = {
  items: {
    variant_id: string;
    quantity: number;
  }[];
  variants: {
    id: string;
    sku: string;
    product?: {
      title: string;
    };
  }[];
};

export const validateInventoryForItems = async (
  input: ValidateInventoryInput,
  container: any,
) => {
  const wmsService: WmsModuleService = container.resolve(WMS_MODULE);

  if (!input.variants?.length) return;

  const errors: MedusaError[] = [];

  await Promise.all(
    input.variants.map(async (variant) => {
      const item = input.items.find((i) => i.variant_id === variant.id)!;
      const skuId = variant.sku;
      const productName = variant.product?.title || variant.id;

      if (!skuId) {
        errors.push(
          new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${productName}: SKU ID가 설정되지 않아 재고 확인이 불가능합니다`,
          ),
        );
        return;
      }

      try {
        const isAvailable = await wmsService.checkAvailableForCart(
          skuId,
          Number(item.quantity),
        );

        if (!isAvailable) {
          errors.push(
            new MedusaError(
              MedusaError.Types.NOT_ALLOWED,
              `${productName}: 재고가 부족합니다`,
            ),
          );
        }
      } catch (error) {
        console.error('[validate-inventory] WMS 에러:', {
          skuId,
          productName,
          error: error.message,
          type: error.type,
        });

        if (error instanceof MedusaError) {
          errors.push(error);
        } else {
          errors.push(
            new MedusaError(
              MedusaError.Types.INVALID_DATA,
              error.message || '재고 확인 중 오류가 발생했습니다',
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
