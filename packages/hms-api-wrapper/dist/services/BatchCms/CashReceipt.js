"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashReceiptService = void 0;
const index_1 = require("../index");
const CashReceipt_zod_1 = require("./CashReceipt.zod");
class CashReceiptService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    /**
     * 현금영수증을 발급합니다.
     * @param custId 고객사 ID (URL 경로에 포함)
     * @param request 현금영수증 발급 요청 데이터
     * @returns 발급된 현금영수증 정보
     */
    async create(custId, request) {
        // 입력값 검증
        const validatedCustId = CashReceipt_zod_1.custIdSchema.parse(custId);
        const validatedRequest = CashReceipt_zod_1.createCashReceiptSchema.parse(request);
        return this.client.post(`/custs/${validatedCustId}/cash-receipts`, validatedRequest);
    }
    /**
     * 발급된 현금영수증을 취소합니다.
     * @param custId 고객사 ID
     * @param cashReceiptId 현금영수증 ID
     * @param request 취소 요청 데이터
     * @returns 취소된 현금영수증 정보
     */
    async cancel(custId, cashReceiptId, request) {
        // 입력값 검증
        const validatedCustId = CashReceipt_zod_1.custIdSchema.parse(custId);
        const validatedCashReceiptId = CashReceipt_zod_1.cashReceiptIdSchema.parse(cashReceiptId);
        const validatedRequest = CashReceipt_zod_1.cancelCashReceiptSchema.parse(request);
        return this.client.post(`/custs/${validatedCustId}/cash-receipts/${validatedCashReceiptId}/cancel`, validatedRequest);
    }
    /**
     * 현금영수증 상세 정보를 조회합니다.
     * @param custId 고객사 ID
     * @param cashReceiptId 현금영수증 ID
     * @returns 조회된 현금영수증 정보
     */
    async get(custId, cashReceiptId) {
        // 입력값 검증
        const validatedCustId = CashReceipt_zod_1.custIdSchema.parse(custId);
        const validatedCashReceiptId = CashReceipt_zod_1.cashReceiptIdSchema.parse(cashReceiptId);
        return this.client.get(`/custs/${validatedCustId}/cash-receipts/${validatedCashReceiptId}`);
    }
    /**
     * 기간별 현금영수증 목록을 조회합니다.
     * @param custId 고객사 ID
     * @param query 조회 조건 (시작일, 종료일)
     * @returns 조회된 현금영수증 목록
     */
    async list(custId, query) {
        // 입력값 검증
        const validatedCustId = CashReceipt_zod_1.custIdSchema.parse(custId);
        const validatedQuery = CashReceipt_zod_1.cashReceiptListQuerySchema.parse(query);
        const queryParams = new URLSearchParams({
            fromReceiptDate: validatedQuery.fromReceiptDate,
            toReceiptDate: validatedQuery.toReceiptDate,
        });
        return this.client.get(`/custs/${validatedCustId}/cash-receipts?${queryParams.toString()}`);
    }
}
exports.CashReceiptService = CashReceiptService;
//# sourceMappingURL=CashReceipt.js.map