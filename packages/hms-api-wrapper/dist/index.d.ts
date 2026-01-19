import { PaymentProfileService } from "./services/PaymentProfile";
import { MemberService, ConsentService, WithdrawalService, CashReceiptService } from "./services/BatchCms";
import { HttpClientConfig } from "./utils/HttpClient.service";
import { PaymentTransactionService } from "./services/PaymentTransaction";
export { HttpClientConfig };
export type { PaymentProfileResult, PaymentProfileLinks, CreatePaymentProfileDto, UpdatePaymentProfileDto, PaymentProfileResponse, HsFmsErrorResponse, PaymentProfileError, } from "./services/PaymentProfile/types";
export type { PaymentTransactionRequest, PaymentResult, PaymentLink, BasePaymentResponse, PaymentApprovalResponse, PaymentCancelResponse, PaymentPartialCancelResponse, } from "./services/PaymentTransaction/types";
export type { CreateMemberRequestDto, CreateMemberResponseDto, CreatedMember, UpdateMemberRequestDto, BatchCmsResult, BatchCmsLink, RegisterAgreementRequest, AgreementFile, AgreementFileResponseDto, RequestPaymentDto, UpdatePaymentDto, PaymentDetails, PaymentResponseDto, CreateCashReceiptRequestDto, CancelCashReceiptRequestDto, CashReceiptResponseDto, CashReceiptListResponseDto, CashReceiptListQueryDto, CashReceiptDetails, CashReceiptCancel, } from "./services/BatchCms/types";
export declare class HmsAPI {
    private httpClient;
    private _paymentProfileService?;
    private _paymentTransactionService?;
    private _memberService?;
    private _consentService?;
    private _withdrawalService?;
    private _cashReceiptService?;
    constructor(options: HttpClientConfig);
    get paymentProfiles(): PaymentProfileService;
    get paymentTransactions(): PaymentTransactionService;
    get members(): MemberService;
    get agreements(): ConsentService;
    get withdrawals(): WithdrawalService;
    get cashReceipts(): CashReceiptService;
}
export * from "./mock";
