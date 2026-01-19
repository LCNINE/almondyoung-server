"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberIdSchema = exports.updateMemberSchema = exports.createMemberSchema = void 0;
const zod_1 = require("zod");
/**
 * 회원 등록 요청 Zod 스키마
 */
exports.createMemberSchema = zod_1.z
    .object({
    /**
     * 회원 ID (고유 값)
     * @constraint 20자, 영문/숫자/-/_/()/
     */
    memberId: zod_1.z
        .string()
        .min(1, "회원 ID는 필수입니다")
        .max(20, "회원 ID는 20자를 초과할 수 없습니다")
        .regex(/^[A-Za-z0-9\-_()]+$/, "회원 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다"),
    /**
     * 회원 이름
     * @constraint 25자, ', ", \ 제외
     */
    memberName: zod_1.z
        .string()
        .min(1, "회원 이름은 필수입니다")
        .max(25, "회원 이름은 25자를 초과할 수 없습니다")
        .regex(/^[^'"\\]+$/, "회원 이름에는 ', \", \\ 문자를 사용할 수 없습니다"),
    /**
     * 납부자 이름
     * @constraint 15자, ', ", \ 제외
     */
    payerName: zod_1.z
        .string()
        .min(1, "납부자 이름은 필수입니다")
        .max(15, "납부자 이름은 15자를 초과할 수 없습니다")
        .regex(/^[^'"\\]+$/, "납부자 이름에는 ', \", \\ 문자를 사용할 수 없습니다"),
    /**
     * 결제 수단 (CMS 고정)
     */
    paymentKind: zod_1.z.literal("CMS", {
        message: "결제 수단은 'CMS'만 가능합니다",
    }),
    /**
     * 결제 기관 (은행 코드)
     * @constraint 3자, 숫자
     */
    paymentCompany: zod_1.z
        .string()
        .length(3, "결제 기관 코드는 3자리여야 합니다")
        .regex(/^\d{3}$/, "결제 기관 코드는 숫자 3자리여야 합니다"),
    /**
     * 결제 번호 (계좌번호)
     * @constraint 16자, 숫자
     */
    paymentNumber: zod_1.z
        .string()
        .min(1, "결제 번호는 필수입니다")
        .max(16, "결제 번호는 16자를 초과할 수 없습니다")
        .regex(/^\d+$/, "결제 번호는 숫자만 입력 가능합니다"),
    /**
     * 납부자 번호 (생년월일 6자리 또는 사업자등록번호 10자리)
     * @constraint 10자, 숫자
     */
    payerNumber: zod_1.z
        .string()
        .length(10, "납부자 번호는 10자리여야 합니다")
        .regex(/^\d{10}$/, "납부자 번호는 숫자 10자리여야 합니다"),
    /**
     * 전화번호
     * @constraint 12자, 숫자
     */
    phone: zod_1.z
        .string()
        .min(1, "전화번호는 필수입니다")
        .max(12, "전화번호는 12자를 초과할 수 없습니다")
        .regex(/^\d+$/, "전화번호는 숫자만 입력 가능합니다"),
    /**
     * SMS 발송여부 (선택사항, 기본값: 'N')
     */
    smsFlag: zod_1.z.enum(["Y", "N", "y", "n"]).optional(),
    /**
     * 이메일 주소 (선택사항)
     * @constraint 40자
     */
    email: zod_1.z
        .string()
        .max(40, "이메일은 40자를 초과할 수 없습니다")
        .email("올바른 이메일 형식이 아닙니다")
        .optional(),
    /**
     * 우편번호 (선택사항)
     * @constraint 7자, 숫자/-
     */
    zipcode: zod_1.z
        .string()
        .max(7, "우편번호는 7자를 초과할 수 없습니다")
        .regex(/^[\d-]+$/, "우편번호는 숫자와 - 문자만 사용 가능합니다")
        .optional(),
    /**
     * 주소 (선택사항)
     * @constraint 100자, ', ", \ 제외
     */
    address1: zod_1.z
        .string()
        .max(100, "주소는 100자를 초과할 수 없습니다")
        .regex(/^[^'"\\]*$/, "주소에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    /**
     * 상세주소 (선택사항)
     * @constraint 100자, ', ", \ 제외
     */
    address2: zod_1.z
        .string()
        .max(100, "상세주소는 100자를 초과할 수 없습니다")
        .regex(/^[^'"\\]*$/, "상세주소에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    /**
     * 이용기관 가입일 (YYYYMMDD) (선택사항)
     * @constraint 8자, 숫자
     */
    joinDate: zod_1.z
        .string()
        .length(8, "가입일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "가입일은 숫자만 입력 가능합니다")
        .refine((date) => {
        const year = parseInt(date.substring(0, 4));
        const month = parseInt(date.substring(4, 6));
        const day = parseInt(date.substring(6, 8));
        if (year < 1900 || year > 2100)
            return false;
        if (month < 1 || month > 12)
            return false;
        if (day < 1 || day > 31)
            return false;
        return true;
    }, { message: "유효하지 않은 가입일 형식입니다" })
        .optional(),
    /**
     * 현금영수증 발행여부 (선택사항)
     */
    receiptFlag: zod_1.z.enum(["Y", "N", "y", "n"]).optional(),
    /**
     * 현금영수증 발행번호 (receiptFlag가 'Y'일 때 필수)
     * @constraint 20자
     */
    receiptNumber: zod_1.z
        .string()
        .max(20, "현금영수증 발행번호는 20자를 초과할 수 없습니다")
        .optional(),
    /**
     * 결제기간 시작일 (YYYYMMDD) (선택사항)
     * @constraint 8자, 숫자
     */
    paymentStartDate: zod_1.z
        .string()
        .length(8, "결제 시작일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "결제 시작일은 숫자만 입력 가능합니다")
        .optional(),
    /**
     * 결제기간 종료일 (YYYYMMDD) (선택사항)
     * @constraint 8자, 숫자
     */
    paymentEndDate: zod_1.z
        .string()
        .length(8, "결제 종료일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "결제 종료일은 숫자만 입력 가능합니다")
        .optional(),
})
    .refine((data) => {
    // receiptFlag가 'Y' 또는 'y'일 때 receiptNumber 필수 검증
    if ((data.receiptFlag === "Y" || data.receiptFlag === "y") &&
        !data.receiptNumber) {
        return false;
    }
    return true;
}, {
    message: "현금영수증 발행여부가 'Y'일 때 발행번호는 필수입니다",
    path: ["receiptNumber"],
})
    .refine((data) => {
    // smsFlag가 'Y' 또는 'y'일 때 phone이 있는지 확인 (이미 필수이므로 항상 통과)
    return true;
});
/**
 * 회원 수정 요청 Zod 스키마
 */
exports.updateMemberSchema = zod_1.z
    .object({
    /**
     * 결제 수단 (CMS 고정) - 항상 필수
     */
    paymentKind: zod_1.z.literal("CMS", {
        message: "결제 수단은 'CMS'만 가능합니다",
    }),
    /**
     * 회원 이름 (선택사항)
     * @constraint 25자, ', ", \ 제외
     */
    memberName: zod_1.z
        .string()
        .max(25, "회원 이름은 25자를 초과할 수 없습니다")
        .regex(/^[^'"\\]+$/, "회원 이름에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    /**
     * SMS 발송여부 (선택사항)
     */
    smsFlag: zod_1.z.enum(["Y", "N", "y", "n"]).optional(),
    /**
     * 전화번호 (smsFlag가 'Y'일 때 필수)
     * @constraint 12자, 숫자
     */
    phone: zod_1.z
        .string()
        .max(12, "전화번호는 12자를 초과할 수 없습니다")
        .regex(/^\d+$/, "전화번호는 숫자만 입력 가능합니다")
        .optional(),
    email: zod_1.z
        .string()
        .max(40, "이메일은 40자를 초과할 수 없습니다")
        .email("올바른 이메일 형식이 아닙니다")
        .optional(),
    zipcode: zod_1.z
        .string()
        .max(7, "우편번호는 7자를 초과할 수 없습니다")
        .regex(/^[\d-]+$/, "우편번호는 숫자와 - 문자만 사용 가능합니다")
        .optional(),
    address1: zod_1.z
        .string()
        .max(100, "주소는 100자를 초과할 수 없습니다")
        .regex(/^[^'"\\]*$/, "주소에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    address2: zod_1.z
        .string()
        .max(100, "상세주소는 100자를 초과할 수 없습니다")
        .regex(/^[^'"\\]*$/, "상세주소에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    joinDate: zod_1.z
        .string()
        .length(8, "가입일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "가입일은 숫자만 입력 가능합니다")
        .optional(),
    receiptFlag: zod_1.z.enum(["Y", "N", "y", "n"]).optional(),
    receiptNumber: zod_1.z
        .string()
        .max(20, "현금영수증 발행번호는 20자를 초과할 수 없습니다")
        .optional(),
    paymentStartDate: zod_1.z
        .string()
        .length(8, "결제 시작일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "결제 시작일은 숫자만 입력 가능합니다")
        .optional(),
    paymentEndDate: zod_1.z
        .string()
        .length(8, "결제 종료일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "결제 종료일은 숫자만 입력 가능합니다")
        .optional(),
    // 결제 정보 변경 시 모두 함께 제공되어야 하는 필드들 (선택사항)
    paymentCompany: zod_1.z
        .string()
        .length(3, "결제 기관 코드는 3자리여야 합니다")
        .regex(/^\d{3}$/, "결제 기관 코드는 숫자 3자리여야 합니다")
        .optional(),
    paymentNumber: zod_1.z
        .string()
        .max(16, "결제 번호는 16자를 초과할 수 없습니다")
        .regex(/^\d+$/, "결제 번호는 숫자만 입력 가능합니다")
        .optional(),
    payerName: zod_1.z
        .string()
        .max(15, "납부자 이름은 15자를 초과할 수 없습니다")
        .regex(/^[^'"\\]+$/, "납부자 이름에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    payerNumber: zod_1.z
        .string()
        .length(10, "납부자 번호는 10자리여야 합니다")
        .regex(/^\d{10}$/, "납부자 번호는 숫자 10자리여야 합니다")
        .optional(),
})
    .refine((data) => {
    // 결제 정보 변경 시 모든 필드가 함께 제공되어야 함
    const paymentFields = [
        data.paymentCompany,
        data.paymentNumber,
        data.payerName,
        data.payerNumber,
    ];
    const providedFields = paymentFields.filter((field) => field !== undefined);
    if (providedFields.length > 0 && providedFields.length !== 4) {
        return false;
    }
    return true;
}, {
    message: "결제 정보를 변경할 때는 paymentCompany, paymentNumber, payerName, payerNumber를 모두 입력해야 합니다",
    path: ["paymentCompany"],
})
    .refine((data) => {
    // smsFlag가 'Y' 또는 'y'일 때 phone 필수
    if ((data.smsFlag === "Y" || data.smsFlag === "y") && !data.phone) {
        return false;
    }
    return true;
}, {
    message: "SMS 발송여부가 'Y'일 때 전화번호는 필수입니다",
    path: ["phone"],
});
/**
 * 회원 ID 검증 스키마
 */
exports.memberIdSchema = zod_1.z
    .string()
    .min(1, "회원 ID는 필수입니다")
    .max(20, "회원 ID는 20자를 초과할 수 없습니다")
    .regex(/^[A-Za-z0-9\-_()]+$/, "회원 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다");
//# sourceMappingURL=Member.zod.js.map