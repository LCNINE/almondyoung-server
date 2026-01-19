"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawalService = void 0;
const index_1 = require("../index");
const Withdrawal_zod_1 = require("./Withdrawal.zod");
class WithdrawalService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    /**
     * 신규 출금을 요청(신청)합니다.
     * @param params 출금 신청에 필요한 정보
     * @returns 출금 요청 결과
     */
    async request(params) {
        // 입력값 검증
        const validatedParams = Withdrawal_zod_1.requestPaymentSchema.parse(params);
        return this.client.post("/payments/cms", validatedParams);
    }
    /**
     * 특정 출금 내역을 조회합니다.
     * @param transactionId 조회할 출금 건의 거래 ID
     * @returns 조회된 출금 내역 상세 정보
     */
    async get(transactionId) {
        // 입력값 검증
        const validatedTransactionId = Withdrawal_zod_1.transactionIdSchema.parse(transactionId);
        return this.client.get(`/payments/cms/${validatedTransactionId}`);
    }
    /**
     * 신청된 출금 내역의 날짜 또는 금액을 수정합니다.
     * @param transactionId 수정할 출금 건의 거래 ID
     * @param params 변경할 출금 날짜와 금액
     * @returns 수정된 출금 요청 결과
     */
    async update(transactionId, params) {
        // 입력값 검증
        const validatedTransactionId = Withdrawal_zod_1.transactionIdSchema.parse(transactionId);
        const validatedParams = Withdrawal_zod_1.updatePaymentSchema.parse(params);
        return this.client.put(`/payments/cms/${validatedTransactionId}`, validatedParams);
    }
    /**
     * 신청된 출금 내역을 삭제합니다.
     * @param transactionId 삭제할 출금 건의 거래 ID
     * @returns 성공 시 내용이 없는 Promise
     */
    async delete(transactionId) {
        // 입력값 검증
        const validatedTransactionId = Withdrawal_zod_1.transactionIdSchema.parse(transactionId);
        return this.client.delete(`/payments/cms/${validatedTransactionId}`);
    }
    /**
     * 여러 조건으로 출금 내역 목록을 조회합니다.
     * @param query 검색 조건 객체. 날짜 또는 페이징 등 조건부 타입으로 제어됩니다.
     * @returns 조회된 출금 내역 목록과 페이지 정보
     */
    async list(query) {
        // 입력값 검증 (선택사항이므로 query가 있을 때만)
        let validatedQuery;
        if (query) {
            validatedQuery = Withdrawal_zod_1.listPaymentsQuerySchema.parse(query);
        }
        // 쿼리 파라미터를 URL 쿼리 스트링으로 변환
        const queryParams = new URLSearchParams();
        if (validatedQuery) {
            if ("fromPaymentDate" in validatedQuery &&
                validatedQuery.fromPaymentDate) {
                queryParams.append("fromPaymentDate", validatedQuery.fromPaymentDate);
            }
            if ("toPaymentDate" in validatedQuery && validatedQuery.toPaymentDate) {
                queryParams.append("toPaymentDate", validatedQuery.toPaymentDate);
            }
            if ("memberId" in validatedQuery && validatedQuery.memberId) {
                queryParams.append("memberId", validatedQuery.memberId);
            }
            if ("memberName" in validatedQuery && validatedQuery.memberName) {
                queryParams.append("memberName", validatedQuery.memberName);
            }
            if ("pageNumber" in validatedQuery && validatedQuery.pageNumber) {
                queryParams.append("pageNumber", validatedQuery.pageNumber.toString());
            }
            if ("pageSize" in validatedQuery && validatedQuery.pageSize) {
                queryParams.append("pageSize", validatedQuery.pageSize.toString());
            }
        }
        const queryString = queryParams.toString();
        const url = queryString ? `/payments/cms?${queryString}` : "/payments/cms";
        return this.client.get(url);
    }
}
exports.WithdrawalService = WithdrawalService;
//# sourceMappingURL=Withdrawal.api.js.map