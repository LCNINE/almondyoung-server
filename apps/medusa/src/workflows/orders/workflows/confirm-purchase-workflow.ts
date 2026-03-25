import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { captureOrderPaymentsStep } from '../steps/capture-order-payments-step';
import { createReviewEligibilityStep } from '../steps/create-review-eligibility-step';

type ConfirmPurchaseInput = {
  orderId: string;
  customerId: string;
  uncapturedPaymentIds: string[];
  items: Array<{ id: string; product_id: string }>;
};

export const confirmPurchaseWorkflow = createWorkflow('confirm-purchase', (input: ConfirmPurchaseInput) => {
  // Step 1: 미캡처 결제 캡처
  const capturedIds = captureOrderPaymentsStep({
    paymentIds: input.uncapturedPaymentIds,
    customerId: input.customerId,
  });

  // Step 2: 리뷰 자격 생성 (실패 시 Step 1 롤백)
  const eligibility = createReviewEligibilityStep({
    customerId: input.customerId,
    orderId: input.orderId,
    items: input.items,
  });

  return new WorkflowResponse({ capturedIds, eligibility });
});
