"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agreementKeySchema = exports.fullRegisterAgreementSchema = exports.fileUploadSchema = exports.registerAgreementSchema = void 0;
const zod_1 = require("zod");
/**
 * 동의자료 등록 요청 검증 스키마 (multipart/form-data)
 */
exports.registerAgreementSchema = zod_1.z.object({
    /**
     * 회원 ID
     * @constraint 20자, 영문/숫자/-/_/()/
     */
    memberId: zod_1.z
        .string()
        .min(1, "회원 ID는 필수입니다")
        .max(20, "회원 ID는 20자를 초과할 수 없습니다")
        .regex(/^[A-Za-z0-9\-_()]+$/, "회원 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다"),
});
/**
 * 파일 업로드 검증 스키마
 */
exports.fileUploadSchema = zod_1.z.object({
    /**
     * 파일 데이터 (Buffer 또는 Blob)
     */
    file: zod_1.z.union([
        zod_1.z.instanceof(Buffer, {
            message: "파일은 Buffer 또는 Blob 형태여야 합니다",
        }),
        zod_1.z.instanceof(Blob, { message: "파일은 Buffer 또는 Blob 형태여야 합니다" }),
    ]),
    /**
     * 파일명
     * 지원되는 확장자: 서면(jpg, jpeg, png, gif, tif, tiff, pdf), 녹취(wav, mp3, wma), 전자서명(der)
     */
    filename: zod_1.z
        .string()
        .min(1, "파일명은 필수입니다")
        .refine((filename) => {
        const supportedExtensions = [
            // 서면 파일
            "jpg",
            "jpeg",
            "png",
            "gif",
            "tif",
            "tiff",
            "pdf",
            // 녹취 파일
            "wav",
            "mp3",
            "wma",
            // 전자서명 파일
            "der",
        ];
        const extension = filename.toLowerCase().split(".").pop();
        return extension && supportedExtensions.includes(extension);
    }, {
        message: "지원되지 않는 파일 형식입니다. 지원 형식: jpg, jpeg, png, gif, tif, tiff, pdf, wav, mp3, wma, der",
    }),
});
/**
 * 전체 동의자료 등록 요청 검증 스키마
 */
exports.fullRegisterAgreementSchema = exports.registerAgreementSchema
    .extend({
    file: zod_1.z.union([zod_1.z.instanceof(Buffer), zod_1.z.instanceof(Blob)]),
    filename: exports.fileUploadSchema.shape.filename,
})
    .refine((data) => {
    // 파일 크기 검증 (개략적인 검증)
    if (data.file instanceof Buffer) {
        const sizeInMB = data.file.length / (1024 * 1024);
        const extension = data.filename.toLowerCase().split(".").pop();
        // 서면: 5MB, 녹취: 300KB (0.3MB), 전자서명: 5KB (0.005MB)
        if (["jpg", "jpeg", "png", "gif", "tif", "tiff", "pdf"].includes(extension || "")) {
            return sizeInMB <= 5;
        }
        else if (["wav", "mp3", "wma"].includes(extension || "")) {
            return sizeInMB <= 0.3;
        }
        else if (extension === "der") {
            return sizeInMB <= 0.005;
        }
    }
    return true; // Blob의 경우 브라우저에서 크기 검증이 어려우므로 통과
}, {
    message: "파일 크기가 허용 범위를 초과했습니다 (서면: 5MB, 녹취: 300KB, 전자서명: 5KB)",
    path: ["file"],
});
/**
 * 고객사 ID 검증 스키마 (내부용)
 */
const custIdSchemaInternal = zod_1.z
    .string()
    .min(1, "고객사 ID는 필수입니다")
    .max(50, "고객사 ID는 50자를 초과할 수 없습니다");
/**
 * 동의키 검증 스키마
 */
exports.agreementKeySchema = zod_1.z
    .string()
    .min(1, "동의키는 필수입니다")
    .max(50, "동의키는 50자를 초과할 수 없습니다");
//# sourceMappingURL=Consent.zod.js.map