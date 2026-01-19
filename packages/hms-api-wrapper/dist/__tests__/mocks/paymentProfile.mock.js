"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockPaymentData = exports.mockProfileData = void 0;
exports.mockProfileData = {
    memberId: "TEST123",
    memberName: "테스트회원",
    phone: "01012345678",
    paymentKind: "CARD",
    paymentNumber: "1234567890123456",
    payerName: "테스트회원",
    payerNumber: "1234567890",
    validYear: "25",
    validMonth: "12",
    password: "00",
};
exports.mockPaymentData = {
    amount: 1000,
    orderId: `TEST_${Date.now()}`,
    productName: "테스트 상품",
};
//# sourceMappingURL=paymentProfile.mock.js.map