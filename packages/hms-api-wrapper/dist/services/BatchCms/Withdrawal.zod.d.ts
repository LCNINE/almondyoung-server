import { z } from "zod";
/**
 * 출금 신청 요청 Zod 스키마
 */
export declare const requestPaymentSchema: z.ZodObject<{
    transactionId: z.ZodString;
    memberId: z.ZodString;
    paymentDate: z.ZodString;
    callAmount: z.ZodNumber;
}, z.core.$strip>;
/**
 * 출금 수정 요청 Zod 스키마
 */
export declare const updatePaymentSchema: z.ZodObject<{
    paymentDate: z.ZodString;
    callAmount: z.ZodNumber;
}, z.core.$strip>;
/**
 * 출금 목록 조회 쿼리 Zod 스키마
 */
export declare const listPaymentsQuerySchema: z.ZodObject<{
    fromPaymentDate: z.ZodOptional<z.ZodString>;
    toPaymentDate: z.ZodOptional<z.ZodString>;
    memberId: z.ZodOptional<z.ZodString>;
    memberName: z.ZodOptional<z.ZodString>;
    pageSize: z.ZodOptional<z.ZodNumber>;
    pageNumber: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/**
 * 거래 ID 검증 스키마
 */
export declare const transactionIdSchema: z.ZodString;
export type RequestPaymentSchemaType = z.infer<typeof requestPaymentSchema>;
export type UpdatePaymentSchemaType = z.infer<typeof updatePaymentSchema>;
export type ListPaymentsQuerySchemaType = z.infer<typeof listPaymentsQuerySchema>;
