import { z } from "zod";
/**
 * 동의자료 등록 요청 검증 스키마 (multipart/form-data)
 */
export declare const registerAgreementSchema: z.ZodObject<{
    memberId: z.ZodString;
}, z.core.$strip>;
/**
 * 파일 업로드 검증 스키마
 */
export declare const fileUploadSchema: z.ZodObject<{
    file: z.ZodUnion<readonly [z.ZodCustom<Buffer<ArrayBufferLike>, Buffer<ArrayBufferLike>>, z.ZodCustom<Blob, Blob>]>;
    filename: z.ZodString;
}, z.core.$strip>;
/**
 * 전체 동의자료 등록 요청 검증 스키마
 */
export declare const fullRegisterAgreementSchema: z.ZodObject<{
    memberId: z.ZodString;
    file: z.ZodUnion<readonly [z.ZodCustom<Buffer<ArrayBufferLike>, Buffer<ArrayBufferLike>>, z.ZodCustom<Blob, Blob>]>;
    filename: z.ZodString;
}, z.core.$strip>;
/**
 * 동의키 검증 스키마
 */
export declare const agreementKeySchema: z.ZodString;
export type RegisterAgreementSchemaType = z.infer<typeof registerAgreementSchema>;
export type FileUploadSchemaType = z.infer<typeof fileUploadSchema>;
export type FullRegisterAgreementSchemaType = z.infer<typeof fullRegisterAgreementSchema>;
