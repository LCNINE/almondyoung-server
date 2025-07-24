import { MedusaError, Modules } from '@medusajs/framework/utils';
import { addToCartWorkflow } from '@medusajs/medusa/core-flows';
import { WMS_MODULE } from '../../../modules/wms';
import { WmsModuleService } from '../../../modules/wms/service';

addToCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  const wmsService: WmsModuleService = container.resolve(WMS_MODULE);
  const productModuleService = container.resolve(Modules.PRODUCT);

  // 요청된 상품 variants 조회
  const productVariants = await productModuleService.listProductVariants(
    {
      id: input.items
        .map((item) => item.variant_id)
        .filter(Boolean) as string[],
    },
    { relations: ['product'] },
  );

  // 각 상품에 대해 재고 확인
  const validationPromises = productVariants.map(async (productVariant) => {
    const item = input.items.find(
      (item) => item.variant_id === productVariant.id,
    )!;

    // SKU ID가 없으면 검증 건너뛰기
    const skuId = productVariant.metadata?.external_id as string;
    if (!skuId) {
      console.warn(
        `Product variant ${productVariant.id} has no external_id (SKU ID)`,
      );
      return;
    }

    // 재고 확인
    const availability = await wmsService.checkAvailableForCart(
      skuId,
      Number(item.quantity),
    );

    if (!availability.canAddToCart) {
      const productName = productVariant.product?.title || productVariant.id;
      const variantName = productVariant.title || '';
      const fullProductName = variantName
        ? `${productName} - ${variantName}`
        : productName;

      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `${fullProductName}: ${availability.reason || '재고가 부족합니다'}`,
      );
    }
  });

  await Promise.all(validationPromises);
});
