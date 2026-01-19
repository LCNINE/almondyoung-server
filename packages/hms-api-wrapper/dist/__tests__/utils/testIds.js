"use strict";
/**
 * 테스트에서 공통으로 사용하는 ID 관리
 * 개발팀 승인을 받은 후 순차적으로 증가시켜 사용
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_CUST_ID = exports.createTestTransactionId = exports.NON_EXISTENT_MEMBER_ID = exports.NEXT_TEST_MEMBER_ID = exports.TEST_MEMBER_ID = void 0;
// 현재 사용 중인 테스트 memberId
exports.TEST_MEMBER_ID = "lcninetest3";
// 다음 테스트용 memberId (승인 후 사용)
exports.NEXT_TEST_MEMBER_ID = "lcninetest2";
// 에러 테스트용 memberId
exports.NON_EXISTENT_MEMBER_ID = "nonexist1";
// 테스트용 transactionId 생성 함수
const createTestTransactionId = (prefix = "TEST") => {
    return `${prefix}_${Date.now()}`;
};
exports.createTestTransactionId = createTestTransactionId;
// 테스트용 custId (동의자료 API용)
exports.TEST_CUST_ID = process.env.CUST_ID || "CUST001";
//# sourceMappingURL=testIds.js.map