import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { updateSortIndexStep } from '../steps/update-sort-index-step';

type SyncPriceSortIndexInput = {
  product_id: string;
  currency_code?: string;
};

export const syncPriceSortIndexWorkflow = createWorkflow(
  'sync-price-sort-index',
  (input: SyncPriceSortIndexInput) => {
    const result = updateSortIndexStep({
      product_id: input.product_id,
      currency_code: input.currency_code ?? 'krw',
    });

    return new WorkflowResponse(result);
  },
);
