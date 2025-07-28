import {
  addToCartWorkflow,
  createCartWorkflow,
} from '@medusajs/medusa/core-flows';
import { validateInventoryForItems } from '../../../utils/validate-inventory';
import {
  AddToCartWorkflowInputDTO,
  CreateCartWorkflowInputDTO,
} from '@medusajs/framework/types';

type CartInput = CreateCartWorkflowInputDTO | AddToCartWorkflowInputDTO;

const validateInventory = async ({ input }, { container }) => {
  console.log('input', input);
  // await validateInventoryForItems(input, container);
};

// 장바구니 생성 시 재고 검증
createCartWorkflow.hooks.validate(validateInventory);

// 장바구니에 상품 추가 시 재고 검증
addToCartWorkflow.hooks.validate(validateInventory);
