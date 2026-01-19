import { YesNo } from "../types";
/**
 * 결제승인 요청 타입
 */
export interface PaymentTransactionRequest {
    transactionId: string;
    memberId: string;
    cardPointFlag?: YesNo;
    callAmount: number;
    vatAmount?: number;
}
export interface PaymentResult {
    flag: string;
    code: string;
    message: string;
}
/**
 * 리소스 URL 타입
 */
export interface PaymentLink {
    rel: string;
    href: string;
}
/**
 * 결제 응답 기본 타입
 */
export interface BasePaymentResponse {
    status: string;
    transactionId: string;
    memberId: string;
    memberName: string;
    paymentDate: string;
    cardPointFlag: YesNo;
    callAmount: number;
    actualAmount: number;
    fee: number;
    vatAmount?: number;
    approvalNumber: string;
    cancelDeadline: string;
    cancelDate?: string | null;
    cancelApplyAmount?: number | null;
    cancelApplyVatAmount?: number | null;
    cancelAmount?: number | null;
    cancelVatAmount?: number | null;
    cancelRemainAmount?: number | null;
    cancelRemainVatAmount?: number | null;
    result: PaymentResult;
    links: PaymentLink[];
}
/**
 * 결제 승인 응답 타입
 */
export interface PaymentApprovalResponse {
    payment: BasePaymentResponse;
}
/**
 * 결제 취소 응답 타입
 */
export interface PaymentCancelResponse {
    payment: BasePaymentResponse;
}
/**
 * 결제 부분취소 응답 타입
 */
export interface PaymentPartialCancelResponse {
    payment: BasePaymentResponse;
}
