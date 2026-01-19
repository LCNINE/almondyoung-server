/**
 * 배치 CMS API 응답에 포함된 결과 객체 인터페이스
 */
export interface BatchCmsResult {
    /**
     * 처리 결과 플래그. 이 값이 'Y'가 아니면 code와 message를 확인해야 합니다.
     * @example 'Y', 'N'
     */
    flag: "Y" | "N" | null;
    /**
     * 처리 결과 코드
     */
    code: string | null;
    /**
     * 처리 결과 메시지
     */
    message: string | null;
}
/**
 * API 응답에 포함된 HATEOAS 링크 정보
 */
export interface BatchCmsLink {
    /**
     * 링크 관계 (e.g., 'self')
     */
    rel: string;
    /**
     * 리소스의 전체 URL
     */
    href: string;
}
/**
 * 회원 등록 요청 시 전달해야 하는 데이터
 */
export interface CreateMemberRequestDto {
    /**
     * 이용기관에서 관리하는 고유 회원 ID
     * @type {string}
     * @constraint 20자, 영문/숫자/-/_/()/
     */
    memberId: string;
    /**
     * 회원 이름
     * @type {string}
     * @constraint 25자, '"' 와 '\' 제외
     */
    memberName: string;
    /**
     * 납부자 이름
     * @type {string}
     * @constraint 15자, '"' 와 '\' 제외
     */
    payerName: string;
    /**
     * 결제 수단
     * @type {string}
     * @constraint 'CMS' 고정 값
     */
    paymentKind: "CMS";
    /**
     * 결제 기관 (은행 코드)
     * @type {string}
     * @constraint 3자, 숫자 (e.g., '088' for 신한은행)
     */
    paymentCompany: string;
    /**
     * 결제 번호 (계좌번호)
     * @type {string}
     * @constraint 16자, 숫자
     */
    paymentNumber: string;
    /**
     * 납부자 번호 (생년월일 6자리 또는 사업자등록번호 10자리)
     * @type {string}
     * @constraint 10자, 숫자
     */
    payerNumber: string;
    /**
     * 전화번호
     * @type {string}
     * @constraint 12자, 숫자
     */
    phone: string;
    /**
     * SMS 발송여부 (기본값: 'Y')
     * @type {'Y' | 'N'}
     * @optional
     */
    smsFlag?: "Y" | "N";
    /**
     * 이메일 주소
     * @type {string}
     * @constraint 40자
     * @optional
     */
    email?: string;
    /**
     * 우편번호
     * @type {string}
     * @constraint 7자, 숫자/-
     * @optional
     */
    zipcode?: string;
    /**
     * 주소
     * @type {string}
     * @constraint 100자, '"' 와 '\' 제외
     * @optional
     */
    address1?: string;
    /**
     * 상세주소
     * @type {string}
     * @constraint 100자, '"' 와 '\' 제외
     * @optional
     */
    address2?: string;
    /**
     * 이용기관 가입일 (YYYYMMDD)
     * @type {string}
     * @constraint 8자, 숫자
     * @optional
     */
    joinDate?: string;
    /**
     * 현금영수증 발행여부
     * @type {'Y' | 'N'}
     * @optional
     */
    receiptFlag?: "Y" | "N";
    /**
     * 현금영수증 발행번호. `receiptFlag`가 'Y'일 때 필수입니다.
     * @type {string}
     * @constraint 20자
     * @optional
     */
    receiptNumber?: string;
    /**
     * 결제기간 시작일 (YYYYMMDD)
     * @type {string}
     * @constraint 8자, 숫자
     * @optional
     */
    paymentStartDate?: string;
    /**
     * 결제기간 종료일 (YYYYMMDD)
     * @type {string}
     * @constraint 8자, 숫자
     * @optional
     */
    paymentEndDate?: string;
}
/**
 * 회원 등록 API 호출 후 응답 데이터에 포함된 member 객체
 */
export interface CreatedMember {
    /**
     * 회원 상태
     * @example '신청대기'
     */
    status: string;
    /**
     * 등록된 회원 ID
     */
    memberId: string;
    /**
     * 등록된 회원 이름
     */
    memberName: string;
    /**
     * 마스킹 처리된 결제 번호 (계좌번호)
     * @example '123****890'
     */
    paymentNumber: string;
    /**
     * 등록된 납부자 이름
     */
    payerName: string;
    /**
     * 등록 처리 결과. 이 객체의 flag 값을 확인하여 최종 성공 여부를 판단해야 합니다.
     */
    result: BatchCmsResult;
    /**
     * 관련 작업 링크 (HATEOAS)
     */
    links: BatchCmsLink[];
}
/**
 * 회원 등록 API의 전체 응답 객체
 */
export interface CreateMemberResponseDto {
    member: CreatedMember;
}
/**
 * 회원 정보 수정 시 사용되는 기본 DTO.
 * `paymentKind`는 항상 필요하며, 나머지 필드는 선택적입니다.
 */
interface UpdateMemberBaseDto {
    /**
     * 결제 수단. 'CMS' 고정 값.
     */
    paymentKind: "CMS";
    /**
     * 회원 이름
     * @constraint 25자, '"' 와 '\' 제외
     */
    memberName?: string;
    /**
     * SMS 발송여부
     * @description 'Y' 또는 'y'로 설정 시 `phone` 필드가 필수입니다.
     */
    smsFlag?: "Y" | "N" | "y" | "n";
    /**
     * 전화번호
     * @constraint 12자, 숫자. `smsFlag`가 'Y' 또는 'y'일 때 필수.
     */
    phone?: string;
    email?: string;
    zipcode?: string;
    address1?: string;
    address2?: string;
    joinDate?: string;
    receiptFlag?: "Y" | "N";
    receiptNumber?: string;
    paymentStartDate?: string;
    paymentEndDate?: string;
}
/**
 * 결제 정보(계좌) 변경 시 반드시 함께 전달해야 하는 필드 그룹
 */
interface PaymentInfoFields {
    /**
     * 결제 기관 (은행 코드)
     * @constraint 3자, 숫자
     */
    paymentCompany: string;
    /**
     * 결제 번호 (계좌번호)
     * @constraint 16자, 숫자
     */
    paymentNumber: string;
    /**
     * 납부자 이름
     * @constraint 15자, '"' 와 '\' 제외
     */
    payerName: string;
    /**
     * 납부자 번호 (생년월일 6자리 또는 사업자등록번호 10자리)
     * @constraint 10자, 숫자
     */
    payerNumber: string;
}
/**
 * 결제 정보를 변경하지 않을 경우, 관련 필드가 없음을 명시하는 타입
 */
interface NoPaymentInfoFields {
    paymentCompany?: never;
    paymentNumber?: never;
    payerName?: never;
    payerNumber?: never;
}
/**
 * 회원 수정 요청을 위한 최종 DTO.
 * 결제 정보를 수정하려면 `PaymentInfoFields`의 모든 필드를 제공해야 하고,
 * 그렇지 않으면 관련 필드를 모두 생략해야 합니다.
 */
export type UpdateMemberRequestDto = UpdateMemberBaseDto & (PaymentInfoFields | NoPaymentInfoFields);
/**
 * 동의자료 등록 요청 타입
 */
export interface RegisterAgreementRequest {
    memberId: string;
    file: Buffer | Blob;
    filename: string;
}
export interface AgreementResult {
    code: string;
    message: string;
}
export interface AgreementFile {
    registerStatus: string;
    agreementKey: string;
    memberId: string;
    memberName: string | null;
    agreementTime: string;
    agreementWay: string;
    agreementKind: string;
    fileExtension: string;
    result?: AgreementResult;
    links?: Array<{
        rel: string;
        href: string;
    }>;
}
export interface AgreementFileResponseDto {
    agreementFile: AgreementFile;
}
/**
 * 출금 신청 요청 DTO
 */
export interface RequestPaymentDto {
    /**
     * 거래 ID (API 호출마다 고유해야 함)
     * @constraint 30자, 영문/숫자/-//()/
     */
    transactionId: string;
    /**
     * 출금 대상 회원 ID
     * @constraint 20자, 영문/숫자/-//()/
     */
    memberId: string;
    /**
     * 출금 요청일 (YYYYMMDD)
     * @constraint 8자, 숫자
     */
    paymentDate: string;
    /**
     * 출금 요청 금액
     * @constraint 12자리
     */
    callAmount: number;
}
/**
 * 출금 수정 요청 DTO
 */
export interface UpdatePaymentDto {
    /**
     * 변경할 출금일 (YYYYMMDD)
     * @constraint 8자, 숫자
     */
    paymentDate: string;
    /**
     * 변경할 출금 요청 금액
     * @constraint 12자리
     */
    callAmount: number;
}
/**
 * 출금 상세 정보 타입
 */
export interface PaymentDetails {
    status: string;
    transactionId: string;
    memberId: string;
    memberName: string;
    paymentDate: string;
    callAmount: number;
    actualAmount: number;
    fee: number;
    result: BatchCmsResult;
    links: Array<{
        rel: string;
        href: string;
    }>;
}
/**
 * 출금 응답 DTO (신청/수정 공통)
 */
export interface PaymentResponseDto {
    payment: PaymentDetails;
}
/**
 * 날짜 범위 타입
 */
export interface DateRange {
    fromPaymentDate: string;
    toPaymentDate: string;
}
/**
 * 페이징 타입
 */
export interface Pagination {
    pageNumber: number;
    pageSize: number;
}
/**
 * 기본 검색 조건 타입
 */
export interface BaseSearchCondition {
    memberId?: string;
    memberName?: string;
}
/**
 * 출금 목록 조회 쿼리 DTO (조건부 타입)
 * 날짜 범위와 페이징은 함께 사용되어야 함
 */
export type ListPaymentsQueryDto = BaseSearchCondition & ((DateRange & {
    pageNumber?: never;
    pageSize?: never;
}) | (Pagination & {
    fromPaymentDate?: never;
    toPaymentDate?: never;
}) | (DateRange & Pagination) | {});
/**
 * 페이지 정보 타입
 */
export interface PageInfo {
    pageNumber: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
}
/**
 * 출금 목록 조회 응답 DTO
 */
export interface ListPaymentsResponseDto {
    totalCnt: number;
    payments: PaymentDetails[];
    page?: PageInfo;
}
export type { CreateCashReceiptRequestDto, CancelCashReceiptRequestDto, CashReceiptResponseDto, CashReceiptListResponseDto, CashReceiptListQueryDto, CashReceiptDetails, CashReceiptCancel, } from "./CashReceipt.types";
