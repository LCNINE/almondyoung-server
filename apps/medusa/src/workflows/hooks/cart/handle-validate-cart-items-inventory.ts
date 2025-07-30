import {
  addToCartWorkflow,
  createCartWorkflow,
} from '@medusajs/medusa/core-flows';
import { validateInventoryForItems } from '../../../utils/validate-inventory';
import {
  AddToCartWorkflowInputDTO,
  CreateCartWorkflowInputDTO,
} from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';

type CartInput = CreateCartWorkflowInputDTO | AddToCartWorkflowInputDTO;

type ValidItem = {
  variant_id: string;
  quantity: number;
}[];

const handleValidateCartItemsInventory = async (
  { input }: { input: CartInput },
  { container },
) => {
  if (input.items?.length) {
    const validItems = input.items as ValidItem;

    if (validItems.length) {
      const productModuleService = container.resolve(Modules.PRODUCT);

      const variants = await productModuleService.listProductVariants(
        {
          id: validItems.map((item) => item.variant_id),
        },
        { relations: ['product'] },
      );

      await validateInventoryForItems(
        { items: validItems, variants },
        container,
      );
    }
  }
};

// 장바구니 생성 시 재고 검증
createCartWorkflow.hooks.validate(handleValidateCartItemsInventory);

// 장바구니에 상품 추가 시 재고 검증
addToCartWorkflow.hooks.validate(handleValidateCartItemsInventory);
