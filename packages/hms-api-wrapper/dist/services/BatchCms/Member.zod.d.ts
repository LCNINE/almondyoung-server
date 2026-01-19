import { z } from "zod";
/**
 * 회원 등록 요청 Zod 스키마
 */
export declare const createMemberSchema: z.ZodObject<{
    memberId: z.ZodString;
    memberName: z.ZodString;
    payerName: z.ZodString;
    paymentKind: z.ZodLiteral<"CMS">;
    paymentCompany: z.ZodString;
    paymentNumber: z.ZodString;
    payerNumber: z.ZodString;
    phone: z.ZodString;
    smsFlag: z.ZodOptional<z.ZodEnum<{
        Y: "Y";
        N: "N";
        y: "y";
        n: "n";
    }>>;
    email: z.ZodOptional<z.ZodString>;
    zipcode: z.ZodOptional<z.ZodString>;
    address1: z.ZodOptional<z.ZodString>;
    address2: z.ZodOptional<z.ZodString>;
    joinDate: z.ZodOptional<z.ZodString>;
    receiptFlag: z.ZodOptional<z.ZodEnum<{
        Y: "Y";
        N: "N";
        y: "y";
        n: "n";
    }>>;
    receiptNumber: z.ZodOptional<z.ZodString>;
    paymentStartDate: z.ZodOptional<z.ZodString>;
    paymentEndDate: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * 회원 수정 요청 Zod 스키마
 */
export declare const updateMemberSchema: z.ZodObject<{
    paymentKind: z.ZodLiteral<"CMS">;
    memberName: z.ZodOptional<z.ZodString>;
    smsFlag: z.ZodOptional<z.ZodEnum<{
        Y: "Y";
        N: "N";
        y: "y";
        n: "n";
    }>>;
    phone: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    zipcode: z.ZodOptional<z.ZodString>;
    address1: z.ZodOptional<z.ZodString>;
    address2: z.ZodOptional<z.ZodString>;
    joinDate: z.ZodOptional<z.ZodString>;
    receiptFlag: z.ZodOptional<z.ZodEnum<{
        Y: "Y";
        N: "N";
        y: "y";
        n: "n";
    }>>;
    receiptNumber: z.ZodOptional<z.ZodString>;
    paymentStartDate: z.ZodOptional<z.ZodString>;
    paymentEndDate: z.ZodOptional<z.ZodString>;
    paymentCompany: z.ZodOptional<z.ZodString>;
    paymentNumber: z.ZodOptional<z.ZodString>;
    payerName: z.ZodOptional<z.ZodString>;
    payerNumber: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * 회원 ID 검증 스키마
 */
export declare const memberIdSchema: z.ZodString;
export type CreateMemberSchemaType = z.infer<typeof createMemberSchema>;
export type UpdateMemberSchemaType = z.infer<typeof updateMemberSchema>;
