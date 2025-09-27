import {
  createWorkflow,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import { createProductStep } from '../steps/create-product-steps';
import { AdminCreateProduct } from '@medusajs/framework/types';

export const createProductWorkflow = createWorkflow(
  'create-product',
  ({ input }: { input: AdminCreateProduct }) => {
    const product = createProductStep({ input });

    return new WorkflowResponse({
      product,
    });
  },
);
