"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentTransactionService = void 0;
const index_1 = require("../index");
// ✅ 클래스명 수정: PaymentTryansactionService -> PaymentTransactionService
class PaymentTransactionService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    // ✅ 메소드명 수정: requestTryansaction -> requestTransaction
    async requestTransaction(request) {
        return this.client.post("/payments/card", request);
    }
    /**
     * 결제를 취소합니다.
     */
    // ✅ 메소드명 수정: cancelTryansaction -> cancelTransaction
    async cancelTransaction(transactionId) {
        return this.client.post(`/payments/card/${transactionId}/cancel`);
    }
    /**
     * 결제를 부분 취소합니다.
     * @param transactionId 거래 ID
     * @param cancelAmount 취소할 금액
     */
    // ✅ 메소드명 수정: cancelPartialTryansaction -> cancelPartialTransaction
    async cancelPartialTransaction(transactionId, cancelAmount) {
        return this.client.post(`/payments/card/${transactionId}/cancel-part`, { cancelAmount });
    }
    /**
     * 결제 승인 정보를 조회합니다.
     * @param transactionId 거래 ID
     * @returns 결제 승인 응답 데이터
     */
    // ✅ 메소드명 수정: getTryansaction -> getTransaction
    async getTransaction(transactionId) {
        return this.client.get(`/payments/card/${transactionId}`);
    }
}
exports.PaymentTransactionService = PaymentTransactionService;
//# sourceMappingURL=PaymentTransaction.js.map