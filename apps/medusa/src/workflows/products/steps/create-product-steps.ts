import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from '@medusajs/framework/workflows-sdk';
import { Modules } from '@medusajs/framework/utils';
import { AdminCreateProduct } from '@medusajs/framework/types';

export const createProductStep = createStep(
  'create-product',
  async ({ input }: { input: AdminCreateProduct }, { container }) => {
    const productService = container.resolve(Modules.PRODUCT);

    const products = await productService.createProducts([
      {
        ...input,
      },
    ]);
    const productIds = products.map((product) => product.id);

    return new StepResponse({ products, productIds }, productIds[0]);
  },
  async (productId, { container }) => {
    if (!productId) {
      return;
    }
    const productService = container.resolve(Modules.PRODUCT);

    await productService.deleteProducts([productId]);
  },
);
