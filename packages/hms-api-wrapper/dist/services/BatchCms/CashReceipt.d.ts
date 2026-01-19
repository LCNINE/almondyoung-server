import { HttpClient } from "../../utils/HttpClient.service";
import { AbstractService } from "../index";
import { CreateCashReceiptRequestDto, CancelCashReceiptRequestDto, CashReceiptResponseDto, CashReceiptListResponseDto, CashReceiptListQueryDto } from "./CashReceipt.types";
export declare class CashReceiptService extends AbstractService {
    constructor(client: HttpClient);
    /**
     * 현금영수증을 발급합니다.
     * @param custId 고객사 ID (URL 경로에 포함)
     * @param request 현금영수증 발급 요청 데이터
     * @returns 발급된 현금영수증 정보
     */
    create(custId: string, request: CreateCashReceiptRequestDto): Promise<CashReceiptResponseDto>;
    /**
     * 발급된 현금영수증을 취소합니다.
     * @param custId 고객사 ID
     * @param cashReceiptId 현금영수증 ID
     * @param request 취소 요청 데이터
     * @returns 취소된 현금영수증 정보
     */
    cancel(custId: string, cashReceiptId: string, request: CancelCashReceiptRequestDto): Promise<CashReceiptResponseDto>;
    /**
     * 현금영수증 상세 정보를 조회합니다.
     * @param custId 고객사 ID
     * @param cashReceiptId 현금영수증 ID
     * @returns 조회된 현금영수증 정보
     */
    get(custId: string, cashReceiptId: string): Promise<CashReceiptResponseDto>;
    /**
     * 기간별 현금영수증 목록을 조회합니다.
     * @param custId 고객사 ID
     * @param query 조회 조건 (시작일, 종료일)
     * @returns 조회된 현금영수증 목록
     */
    list(custId: string, query: CashReceiptListQueryDto): Promise<CashReceiptListResponseDto>;
}
