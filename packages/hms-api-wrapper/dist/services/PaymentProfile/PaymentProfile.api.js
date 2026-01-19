"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentProfileService = void 0;
const index_1 = require("../index");
class PaymentProfileService extends index_1.AbstractService {
    async create(profile) {
        // 결제수단은 항상 'CARD'로 설정
        const requestData = {
            ...profile,
            paymentKind: "CARD",
        };
        return this.client.post("/members", requestData);
    }
    async update(memberId, profile) {
        return this.client.put(`/members/${memberId}`, profile);
    }
    async delete(memberId) {
        return this.client.delete(`/members/${memberId}`);
    }
    async get(memberId) {
        return this.client.get(`/members/${memberId}`);
    }
}
exports.PaymentProfileService = PaymentProfileService;
//# sourceMappingURL=PaymentProfile.api.js.map