import { HttpClient } from "../../utils/HttpClient.service";
import { AbstractService } from "../index";
import { PaymentTransactionRequest, PaymentApprovalResponse, PaymentCancelResponse, PaymentPartialCancelResponse } from "./types";
export declare class PaymentTransactionService extends AbstractService {
    constructor(client: HttpClient);
    requestTransaction(request: PaymentTransactionRequest): Promise<PaymentApprovalResponse>;
    /**
     * 결제를 취소합니다.
     */
    cancelTransaction(transactionId: string): Promise<PaymentCancelResponse>;
    /**
     * 결제를 부분 취소합니다.
     * @param transactionId 거래 ID
     * @param cancelAmount 취소할 금액
     */
    cancelPartialTransaction(transactionId: string, cancelAmount: number): Promise<PaymentPartialCancelResponse>;
    /**
     * 결제 승인 정보를 조회합니다.
     * @param transactionId 거래 ID
     * @returns 결제 승인 응답 데이터
     */
    getTransaction(transactionId: string): Promise<PaymentApprovalResponse>;
}
