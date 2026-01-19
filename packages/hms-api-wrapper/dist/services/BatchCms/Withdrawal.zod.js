"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionIdSchema = exports.listPaymentsQuerySchema = exports.updatePaymentSchema = exports.requestPaymentSchema = void 0;
const zod_1 = require("zod");
/**
 * 출금 신청 요청 Zod 스키마
 */
exports.requestPaymentSchema = zod_1.z.object({
    /**
     * 거래 ID (고유 값)
     * @constraint 30자, 영문/숫자/-/_/()/
     */
    transactionId: zod_1.z
        .string()
        .min(1, "거래 ID는 필수입니다")
        .max(30, "거래 ID는 30자를 초과할 수 없습니다")
        .regex(/^[A-Za-z0-9\-_()]+$/, "거래 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다"),
    /**
     * 출금 대상 회원 ID
     * @constraint 20자, 영문/숫자/-/_/()/
     */
    memberId: zod_1.z
        .string()
        .min(1, "회원 ID는 필수입니다")
        .max(20, "회원 ID는 20자를 초과할 수 없습니다")
        .regex(/^[A-Za-z0-9\-_()]+$/, "회원 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다"),
    /**
     * 출금 요청일 (YYYYMMDD)
     * @constraint 8자, 숫자
     */
    paymentDate: zod_1.z
        .string()
        .length(8, "출금일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "출금일은 숫자만 입력 가능합니다")
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
        // 미래 날짜인지 확인 (1달 이내 영업일)
        const requestDate = new Date(year, month - 1, day);
        const today = new Date();
        const oneMonthLater = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
        return requestDate >= today && requestDate <= oneMonthLater;
    }, { message: "출금일은 오늘부터 1달 이내의 날짜여야 합니다" }),
    /**
     * 출금 요청 금액
     * @constraint 12자리
     */
    callAmount: zod_1.z
        .number()
        .int("출금 요청 금액은 정수여야 합니다")
        .min(1, "출금 요청 금액은 1원 이상이어야 합니다")
        .max(999999999999, "출금 요청 금액은 12자리를 초과할 수 없습니다"),
});
/**
 * 출금 수정 요청 Zod 스키마
 */
exports.updatePaymentSchema = zod_1.z.object({
    /**
     * 변경할 출금일 (YYYYMMDD)
     * @constraint 8자, 숫자
     */
    paymentDate: zod_1.z
        .string()
        .length(8, "출금일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "출금일은 숫자만 입력 가능합니다")
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
    }, { message: "유효하지 않은 출금일 형식입니다" }),
    /**
     * 변경할 출금 요청 금액
     * @constraint 12자리
     */
    callAmount: zod_1.z
        .number()
        .int("출금 요청 금액은 정수여야 합니다")
        .min(1, "출금 요청 금액은 1원 이상이어야 합니다")
        .max(999999999999, "출금 요청 금액은 12자리를 초과할 수 없습니다"),
});
/**
 * 출금 목록 조회 쿼리 Zod 스키마
 */
exports.listPaymentsQuerySchema = zod_1.z
    .object({
    /**
     * 검색기간 시작일 (YYYYMMDD) (선택사항)
     * @constraint 8자, 숫자
     */
    fromPaymentDate: zod_1.z
        .string()
        .length(8, "시작일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "시작일은 숫자만 입력 가능합니다")
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
    }, { message: "유효하지 않은 시작일 형식입니다" })
        .optional(),
    /**
     * 검색기간 종료일 (YYYYMMDD) (선택사항)
     * @constraint 8자, 숫자
     */
    toPaymentDate: zod_1.z
        .string()
        .length(8, "종료일은 YYYYMMDD 형식 8자리여야 합니다")
        .regex(/^\d{8}$/, "종료일은 숫자만 입력 가능합니다")
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
    }, { message: "유효하지 않은 종료일 형식입니다" })
        .optional(),
    /**
     * 회원 ID (선택사항)
     * @constraint 20자, 영문/숫자/-/_/()/
     */
    memberId: zod_1.z
        .string()
        .max(20, "회원 ID는 20자를 초과할 수 없습니다")
        .regex(/^[A-Za-z0-9\-_()]+$/, "회원 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다")
        .optional(),
    /**
     * 회원 이름 (선택사항)
     * @constraint 25자, ', ", \ 제외
     */
    memberName: zod_1.z
        .string()
        .max(25, "회원 이름은 25자를 초과할 수 없습니다")
        .regex(/^[^'"\\]*$/, "회원 이름에는 ', \", \\ 문자를 사용할 수 없습니다")
        .optional(),
    /**
     * 페이지 당 건수 (선택사항)
     * @constraint 5자, 숫자
     */
    pageSize: zod_1.z
        .number()
        .int("페이지 크기는 정수여야 합니다")
        .min(1, "페이지 크기는 1 이상이어야 합니다")
        .max(99999, "페이지 크기는 5자리를 초과할 수 없습니다")
        .optional(),
    /**
     * 페이지 순번 (1부터 시작) (선택사항)
     * @constraint 5자, 숫자
     */
    pageNumber: zod_1.z
        .number()
        .int("페이지 번호는 정수여야 합니다")
        .min(1, "페이지 번호는 1 이상이어야 합니다")
        .max(99999, "페이지 번호는 5자리를 초과할 수 없습니다")
        .optional(),
})
    .refine((data) => {
    // fromPaymentDate와 toPaymentDate는 함께 요청되어야 함
    if ((data.fromPaymentDate && !data.toPaymentDate) ||
        (!data.fromPaymentDate && data.toPaymentDate)) {
        return false;
    }
    return true;
}, {
    message: "시작일과 종료일은 함께 입력해야 합니다",
    path: ["fromPaymentDate"],
})
    .refine((data) => {
    // pageSize와 pageNumber는 함께 요청되어야 함
    if ((data.pageSize && !data.pageNumber) ||
        (!data.pageSize && data.pageNumber)) {
        return false;
    }
    return true;
}, {
    message: "페이지 크기와 페이지 번호는 함께 입력해야 합니다",
    path: ["pageSize"],
})
    .refine((data) => {
    // 날짜 범위가 최대 6개월인지 확인
    if (data.fromPaymentDate && data.toPaymentDate) {
        const fromDate = new Date(parseInt(data.fromPaymentDate.substring(0, 4)), parseInt(data.fromPaymentDate.substring(4, 6)) - 1, parseInt(data.fromPaymentDate.substring(6, 8)));
        const toDate = new Date(parseInt(data.toPaymentDate.substring(0, 4)), parseInt(data.toPaymentDate.substring(4, 6)) - 1, parseInt(data.toPaymentDate.substring(6, 8)));
        // 시작일이 종료일보다 이후가 아닌지 확인
        if (fromDate > toDate) {
            return false;
        }
        // 6개월 범위 확인 (대략적으로 180일로 계산)
        const diffTime = toDate.getTime() - fromDate.getTime();
        const diffDays = diffTime / (1000 * 3600 * 24);
        return diffDays <= 180;
    }
    return true;
}, {
    message: "검색 기간은 최대 6개월까지 가능하며, 시작일은 종료일보다 이후일 수 없습니다",
    path: ["toPaymentDate"],
});
/**
 * 거래 ID 검증 스키마
 */
exports.transactionIdSchema = zod_1.z
    .string()
    .min(1, "거래 ID는 필수입니다")
    .max(30, "거래 ID는 30자를 초과할 수 없습니다")
    .regex(/^[A-Za-z0-9\-_()]+$/, "거래 ID는 영문, 숫자, -, _, (), / 만 사용 가능합니다");
//# sourceMappingURL=Withdrawal.zod.js.map