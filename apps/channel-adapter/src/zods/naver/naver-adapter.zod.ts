import z from 'zod';

// 명령 검증용 Zod 스키마들
export const OrderConfirmCommandSchema = z.object({
  type: z.literal('order.confirm'),
  productOrderIds: z
    .array(z.string())
    .min(1, '최소 1개의 상품 주문 번호가 필요합니다'),
});

export const DispatchDelayCommandSchema = z.object({
  type: z.literal('dispatch.delay'),
  productOrderId: z.string().min(1, '상품 주문 번호는 필수입니다'),
  dispatchDueDate: z.iso.datetime('발송 예정일은 ISO 8601 형식이어야 합니다'),
  reasonCode: z.string().min(1, '지연 사유 코드는 필수입니다'),
  reasonText: z.string().min(1, '지연 사유 상세는 필수입니다'),
});

export const CancelApproveCommandSchema = z.union([
  z.object({
    type: z.literal('cancel.approve'),
    claimId: z.string().min(1, '클레임 ID는 필수입니다'),
  }),
  z.object({
    type: z.literal('cancel.approve'),
    orderId: z.string().min(1, '주문 ID는 필수입니다'),
  }),
]);

export const ReturnApproveCommandSchema = z.union([
  z.object({
    type: z.literal('return.approve'),
    claimId: z.string().min(1, '클레임 ID는 필수입니다'),
  }),
  z.object({
    type: z.literal('return.approve'),
    orderId: z.string().min(1, '주문 ID는 필수입니다'),
  }),
]);
