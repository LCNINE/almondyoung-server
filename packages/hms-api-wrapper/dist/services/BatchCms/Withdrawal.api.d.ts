import { HttpClient } from "../../utils/HttpClient.service";
import { AbstractService } from "../index";
import { RequestPaymentDto, UpdatePaymentDto, PaymentResponseDto, ListPaymentsQueryDto, ListPaymentsResponseDto } from "./types";
export declare class WithdrawalService extends AbstractService {
    constructor(client: HttpClient);
    /**
     * 신규 출금을 요청(신청)합니다.
     * @param params 출금 신청에 필요한 정보
     * @returns 출금 요청 결과
     */
    request(params: RequestPaymentDto): Promise<PaymentResponseDto>;
    /**
     * 특정 출금 내역을 조회합니다.
     * @param transactionId 조회할 출금 건의 거래 ID
     * @returns 조회된 출금 내역 상세 정보
     */
    get(transactionId: string): Promise<PaymentResponseDto>;
    /**
     * 신청된 출금 내역의 날짜 또는 금액을 수정합니다.
     * @param transactionId 수정할 출금 건의 거래 ID
     * @param params 변경할 출금 날짜와 금액
     * @returns 수정된 출금 요청 결과
     */
    update(transactionId: string, params: UpdatePaymentDto): Promise<PaymentResponseDto>;
    /**
     * 신청된 출금 내역을 삭제합니다.
     * @param transactionId 삭제할 출금 건의 거래 ID
     * @returns 성공 시 내용이 없는 Promise
     */
    delete(transactionId: string): Promise<void>;
    /**
     * 여러 조건으로 출금 내역 목록을 조회합니다.
     * @param query 검색 조건 객체. 날짜 또는 페이징 등 조건부 타입으로 제어됩니다.
     * @returns 조회된 출금 내역 목록과 페이지 정보
     */
    list(query?: ListPaymentsQueryDto): Promise<ListPaymentsResponseDto>;
}
