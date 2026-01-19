import { z } from "zod";
/**
 * 현금영수증 발급 요청 Zod 스키마
 */
export declare const createCashReceiptSchema: z.ZodObject<{
    cashReceiptId: z.ZodString;
    receiptNumber: z.ZodString;
    supplyAmount: z.ZodNumber;
    vatAmount: z.ZodNumber;
    serviceAmount: z.ZodNumber;
    totalAmount: z.ZodNumber;
}, z.core.$strip>;
/**
 * 현금영수증 취소 요청 Zod 스키마
 */
export declare const cancelCashReceiptSchema: z.ZodObject<{
    cancelReason: z.ZodEnum<{
        현금결제취소: "현금결제취소";
        오류발급: "오류발급";
        기타: "기타";
    }>;
}, z.core.$strip>;
/**
 * 현금영수증 기간 조회 쿼리 Zod 스키마
 */
export declare const cashReceiptListQuerySchema: z.ZodObject<{
    fromReceiptDate: z.ZodString;
    toReceiptDate: z.ZodString;
}, z.core.$strip>;
/**
 * 고객사 ID 검증 스키마
 */
export declare const custIdSchema: z.ZodString;
/**
 * 현금영수증 ID 검증 스키마
 */
export declare const cashReceiptIdSchema: z.ZodString;
export type CreateCashReceiptSchemaType = z.infer<typeof createCashReceiptSchema>;
export type CancelCashReceiptSchemaType = z.infer<typeof cancelCashReceiptSchema>;
export type CashReceiptListQuerySchemaType = z.infer<typeof cashReceiptListQuerySchema>;
