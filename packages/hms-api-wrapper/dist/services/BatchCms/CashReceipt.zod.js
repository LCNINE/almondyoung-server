"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cashReceiptIdSchema = exports.custIdSchema = exports.cashReceiptListQuerySchema = exports.cancelCashReceiptSchema = exports.createCashReceiptSchema = void 0;
const zod_1 = require("zod");
/**
 * 현금영수증 발급 요청 Zod 스키마
 */
exports.createCashReceiptSchema = zod_1.z
    .object({
    /**
     * 현금영수증 ID (고유 값)
     * @constraint 20자, 영문/숫자/-/_/()/
     */
    cashReceiptId: zod_1.z
        .string()
        .min(1, "현금영수증 ID는 필수입니다")
        .max(20, "현금영수증 ID는 20자를 초과할 수 없습니다")
        .regex(/^[A-Za-z0-9\-_()]+$/, "현금영수증 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다"),
    /**
     * 발급 번호 (휴대폰번호 또는 사업자등록번호)
     * @constraint 20자, 숫자
     */
    receiptNumber: zod_1.z
        .string()
        .min(1, "발급 번호는 필수입니다")
        .max(20, "발급 번호는 20자를 초과할 수 없습니다")
        .regex(/^\d+$/, "발급 번호는 숫자만 입력 가능합니다"),
    /**
     * 공급가액
     * @constraint 12자리 숫자, 양수
     */
    supplyAmount: zod_1.z
        .number()
        .int("공급가액은 정수여야 합니다")
        .min(0, "공급가액은 0 이상이어야 합니다")
        .max(999999999999, "공급가액은 12자리를 초과할 수 없습니다"),
    /**
     * 부가가치세
     * @constraint 12자리 숫자, 0 이상
     */
    vatAmount: zod_1.z
        .number()
        .int("부가가치세는 정수여야 합니다")
        .min(0, "부가가치세는 0 이상이어야 합니다")
        .max(999999999999, "부가가치세는 12자리를 초과할 수 없습니다"),
    /**
     * 봉사료
     * @constraint 12자리 숫자, 0 이상
     */
    serviceAmount: zod_1.z
        .number()
        .int("봉사료는 정수여야 합니다")
        .min(0, "봉사료는 0 이상이어야 합니다")
        .max(999999999999, "봉사료는 12자리를 초과할 수 없습니다"),
    /**
     * 거래금액 (공급가액 + 부가가치세 + 봉사료)
     * @constraint 12자리 숫자, 양수
     */
    totalAmount: zod_1.z
        .number()
        .int("거래금액은 정수여야 합니다")
        .min(1, "거래금액은 1 이상이어야 합니다")
        .max(999999999999, "거래금액은 12자리를 초과할 수 없습니다"),
})
    .refine((data) => data.totalAmount ===
    data.supplyAmount + data.vatAmount + data.serviceAmount, {
    message: "거래금액은 공급가액 + 부가가치세 + 봉사료의 합과 같아야 합니다",
    path: ["totalAmount"],
});
/**
 * 현금영수증 취소 요청 Zod 스키마
 */
exports.cancelCashReceiptSchema = zod_1.z.object({
    /**
     * 취소사유
     * @constraint 허용된 값: "현금결제취소", "오류발급", "기타"
     */
    cancelReason: zod_1.z.enum(["현금결제취소", "오류발급", "기타"], {
        message: "취소사유는 '현금결제취소', '오류발급', '기타' 중 하나여야 합니다",
    }),
});
/**
 * 현금영수증 기간 조회 쿼리 Zod 스키마
 */
exports.cashReceiptListQuerySchema = zod_1.z
    .object({
    /**
     * 조회 시작일 (YYYYMMDD)
     * @constraint 8자리 숫자
     */
    fromReceiptDate: zod_1.z
        .string()
        .length(8, "시작일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "시작일은 숫자만 입력 가능합니다")
        .refine((date) => {
        const year = parseInt(date.substring(0, 4));
        const month = parseInt(date.substring(4, 6));
        const day = parseInt(date.substring(6, 8));
        // 기본적인 날짜 유효성 검사
        if (year < 1900 || year > 2100)
            return false;
        if (month < 1 || month > 12)
            return false;
        if (day < 1 || day > 31)
            return false;
        return true;
    }, { message: "유효하지 않은 시작일 형식입니다" }),
    /**
     * 조회 종료일 (YYYYMMDD)
     * @constraint 8자리 숫자
     */
    toReceiptDate: zod_1.z
        .string()
        .length(8, "종료일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "종료일은 숫자만 입력 가능합니다")
        .refine((date) => {
        const year = parseInt(date.substring(0, 4));
        const month = parseInt(date.substring(4, 6));
        const day = parseInt(date.substring(6, 8));
        // 기본적인 날짜 유효성 검사
        if (year < 1900 || year > 2100)
            return false;
        if (month < 1 || month > 12)
            return false;
        if (day < 1 || day > 31)
            return false;
        return true;
    }, { message: "유효하지 않은 종료일 형식입니다" }),
})
    .refine((data) => {
    // 시작일이 종료일보다 이후가 아닌지 확인
    return data.fromReceiptDate <= data.toReceiptDate;
}, {
    message: "시작일은 종료일보다 이후일 수 없습니다",
    path: ["fromReceiptDate"],
});
/**
 * 고객사 ID 검증 스키마
 */
exports.custIdSchema = zod_1.z
    .string()
    .min(1, "고객사 ID는 필수입니다")
    .max(50, "고객사 ID는 50자를 초과할 수 없습니다");
/**
 * 현금영수증 ID 검증 스키마
 */
exports.cashReceiptIdSchema = zod_1.z
    .string()
    .min(1, "현금영수증 ID는 필수입니다")
    .max(20, "현금영수증 ID는 20자를 초과할 수 없습니다")
    .regex(/^[A-Za-z0-9\-_()]+$/, "현금영수증 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다");
//# sourceMappingURL=CashReceipt.zod.js.map