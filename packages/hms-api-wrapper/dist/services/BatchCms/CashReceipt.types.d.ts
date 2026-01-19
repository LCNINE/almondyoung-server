import { BatchCmsResult, BatchCmsLink } from "./types";
/**
 * 현금영수증 발급 요청 DTO
 */
export interface CreateCashReceiptRequestDto {
    /**
     * 현금영수증 ID (고유 값)
     * @constraint 20자, 영문/숫자/-/_/()/
     * @example "CASH-RECEIPT-01"
     */
    cashReceiptId: string;
    /**
     * 발급 번호 (휴대폰번호 또는 사업자등록번호)
     * @constraint 20자, 숫자
     * @example "01012345678"
     */
    receiptNumber: string;
    /**
     * 공급가액
     * @constraint 12자리 숫자
     * @example 10000
     */
    supplyAmount: number;
    /**
     * 부가가치세
     * @constraint 12자리 숫자
     * @example 1000
     */
    vatAmount: number;
    /**
     * 봉사료
     * @constraint 12자리 숫자
     * @example 0
     */
    serviceAmount: number;
    /**
     * 거래금액 (공급가액 + 부가가치세 + 봉사료)
     * @constraint 12자리 숫자
     * @example 11000
     */
    totalAmount: number;
}
/**
 * 현금영수증 취소 요청 DTO
 */
export interface CancelCashReceiptRequestDto {
    /**
     * 취소사유
     * @constraint 6자, 영문/숫자/한글
     * @example "현금결제취소", "오류발급", "기타"
     */
    cancelReason: "현금결제취소" | "오류발급" | "기타";
}
/**
 * 현금영수증 취소 정보
 */
export interface CashReceiptCancel {
    /**
     * 취소일 (YYYY/MM/DD 형식)
     * @example "2016/08/16"
     */
    date: string | null;
    /**
     * 취소 승인번호
     * @example "E70000003"
     */
    approvalNumber: string | null;
    /**
     * 취소 사유
     * @example "현금결제취소"
     */
    reason: string | null;
}
/**
 * 현금영수증 상세 정보
 */
export interface CashReceiptDetails {
    /**
     * 현금영수증 ID
     */
    cashReceiptId: string;
    /**
     * 현금영수증 상태
     * @example "발급 완료", "취소 완료"
     */
    status: string;
    /**
     * 발급 번호
     */
    receiptNumber: string;
    /**
     * 공급가액
     */
    supplyAmount: number;
    /**
     * 부가가치세
     */
    vatAmount: number;
    /**
     * 봉사료
     */
    serviceAmount: number;
    /**
     * 거래금액
     */
    totalAmount: number;
    /**
     * 발급일 (YYYY/MM/DD 형식)
     * @example "2016/08/15"
     */
    receiptDate: string;
    /**
     * 발급 승인번호
     * @example "E70000001"
     */
    receiptApprovalNumber: string;
    /**
     * 발급 목적
     * @example "현금(소득공제)"
     */
    receiptPurpose: string;
    /**
     * 취소 정보
     */
    cancel: CashReceiptCancel;
    /**
     * 처리 결과
     */
    result: BatchCmsResult;
    /**
     * HATEOAS 링크
     */
    links: BatchCmsLink[];
}
/**
 * 현금영수증 생성/조회/취소 응답 DTO
 */
export interface CashReceiptResponseDto {
    cashReceipt: CashReceiptDetails;
}
/**
 * 현금영수증 기간 조회 응답 DTO
 */
export interface CashReceiptListResponseDto {
    /**
     * 총 현금영수증 건수
     */
    totalCount: number;
    /**
     * 현금영수증 목록
     */
    cashReceipts: CashReceiptDetails[];
}
/**
 * 현금영수증 기간 조회 쿼리 파라미터
 */
export interface CashReceiptListQueryDto {
    /**
     * 조회 시작일 (YYYYMMDD)
     * @constraint 8자리 숫자
     * @example "20160801"
     */
    fromReceiptDate: string;
    /**
     * 조회 종료일 (YYYYMMDD)
     * @constraint 8자리 숫자
     * @example "20160831"
     */
    toReceiptDate: string;
}
