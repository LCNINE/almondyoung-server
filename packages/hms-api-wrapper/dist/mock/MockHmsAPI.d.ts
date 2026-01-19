import { HttpClient } from "../utils/HttpClient.service";
import { AbstractService } from "../services/index";
import { CreateMemberRequestDto, CreateMemberResponseDto, UpdateMemberRequestDto, AgreementFileResponseDto, RequestPaymentDto, UpdatePaymentDto, PaymentResponseDto, ListPaymentsQueryDto, ListPaymentsResponseDto } from "../services/BatchCms/types";
declare class MockHttpClient extends HttpClient {
    private mockBaseURL;
    constructor(config: any);
    get<T>(url: string): Promise<T>;
    post<T>(url: string, data?: any, config?: any): Promise<T>;
    put<T>(url: string, data?: any): Promise<T>;
    delete<T>(url: string): Promise<T>;
}
declare class MockMemberService extends AbstractService {
    constructor(client: MockHttpClient);
    create(memberData: CreateMemberRequestDto): Promise<CreateMemberResponseDto>;
    update(memberId: string, memberData: UpdateMemberRequestDto): Promise<CreateMemberResponseDto>;
    get(memberId: string): Promise<CreateMemberResponseDto>;
    delete(memberId: string): Promise<void>;
}
declare class MockConsentService extends AbstractService {
    constructor(client: MockHttpClient);
    register(custId: string, memberId: string, fileInput: {
        file: Buffer | Blob;
        filename: string;
    }): Promise<AgreementFileResponseDto>;
    get(custId: string, agreementKey: string): Promise<AgreementFileResponseDto>;
}
declare class MockWithdrawalService extends AbstractService {
    constructor(client: MockHttpClient);
    request(params: RequestPaymentDto): Promise<PaymentResponseDto>;
    get(transactionId: string): Promise<PaymentResponseDto>;
    update(transactionId: string, params: UpdatePaymentDto): Promise<PaymentResponseDto>;
    delete(transactionId: string): Promise<void>;
    list(query?: ListPaymentsQueryDto): Promise<ListPaymentsResponseDto>;
}
export declare class MockHmsAPI {
    private httpClient;
    private _memberService?;
    private _consentService?;
    private _withdrawalService?;
    constructor(options: any);
    get members(): MockMemberService;
    get agreements(): MockConsentService;
    get withdrawals(): MockWithdrawalService;
    healthCheck(): Promise<any>;
}
export {};
