import { z } from 'zod';
import {
  DeliveryMethodSchema,
  HoldbackReasonSchema,
  ReturnReasonSchema,
  CancelReasonSchema,
} from './naver-core.zod';

// =================================================================
// == 1. 교환 (Exchange) Body 스키마
// (from naver-api.zod.ts)
// =================================================================

/** 교환 재배송 Body */
export const ExchangeRedeliveryBodySchema = z.object({
  reDeliveryMethod: DeliveryMethodSchema,
  reDeliveryCompany: z.string().min(1, '재배송 택배사는 필수입니다'),
  reDeliveryTrackingNumber: z.string().min(1, '재배송 송장번호는 필수입니다'),
});
export type ExchangeRedeliveryBody = z.infer<
  typeof ExchangeRedeliveryBodySchema
>;

/** 교환 보류 Body */
export const HoldExchangeBodySchema = z.object({
  holdbackClassType: HoldbackReasonSchema,
  holdbackExchangeDetailReason: z
    .string()
    .min(1, '교환 보류 상세 사유는 필수입니다'),
  extraExchangeFeeAmount: z.number().int().optional(),
});
export type HoldExchangeBody = z.infer<typeof HoldExchangeBodySchema>;

/** 교환 거부 Body */
export const RejectExchangeBodySchema = z.object({
  rejectExchangeReason: z.string().min(1, '교환 거부 사유는 필수입니다'),
});
export type RejectExchangeBody = z.infer<typeof RejectExchangeBodySchema>;

// =================================================================
// == 2. 반품 (Return) Body 스키마
// (from naver-api.zod.ts)
// =================================================================

/** 반품 보류 Body */
export const HoldReturnBodySchema = z.object({
  holdbackClassType: HoldbackReasonSchema,
  holdbackReturnDetailReason: z
    .string()
    .min(1, '반품 보류 상세 사유는 필수입니다'),
  extraReturnFeeAmount: z.number().int().optional(),
});
export type HoldReturnBody = z.infer<typeof HoldReturnBodySchema>;

/** 반품 거부 Body */
export const RejectReturnBodySchema = z.object({
  rejectReturnReason: z.string().min(1, '반품 거부 사유는 필수입니다'),
});
export type RejectReturnBody = z.infer<typeof RejectReturnBodySchema>;

/** 반품 요청 Body */
export const RequestReturnBodySchema = z.object({
  returnReason: ReturnReasonSchema,
  collectDeliveryMethod: DeliveryMethodSchema,
  collectDeliveryCompany: z.string().optional(),
  collectTrackingNumber: z.string().optional(),
  returnQuantity: z.number().int().positive().optional(),
});
export type RequestReturnBody = z.infer<typeof RequestReturnBodySchema>;

// =================================================================
// == 3. 취소 (Cancel) Body 스키마
// (from naver-api.zod.ts)
// =================================================================

/** 취소 요청 Body */
export const RequestCancelBodySchema = z.object({
  cancelReason: CancelReasonSchema,
  cancelDetailedReason: z.string().max(500).optional(),
  cancelQuantity: z.number().int().positive().optional(),
});
export type RequestCancelBody = z.infer<typeof RequestCancelBodySchema>;
