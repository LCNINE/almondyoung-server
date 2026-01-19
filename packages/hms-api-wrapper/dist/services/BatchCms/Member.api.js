"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemberService = void 0;
const index_1 = require("../index");
const Member_zod_1 = require("./Member.zod");
class MemberService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    /**
     * 신규 회원을 등록합니다.
     * @param memberData 등록할 회원 정보
     * @returns API 응답 결과. `response.member.result` 객체를 통해 실제 성공 여부를 확인해야 합니다.
     */
    async create(memberData) {
        // 입력값 검증
        const validatedMemberData = Member_zod_1.createMemberSchema.parse(memberData);
        return this.client.post("/members", validatedMemberData);
    }
    /**
     * 회원을 수정하거나, 존재하지 않을 경우 신규 등록(Upsert)합니다.
     *
     * @param memberId 대상 회원의 ID
     * @param memberData 수정할 회원 정보. 결제정보(paymentCompany 등 4개 필드)는 전부 포함하거나 전부 제외해야 합니다.
     * @returns API 응답 결과. `response.member.result` 객체를 통해 실제 성공 여부를 확인해야 합니다.
     */
    async update(memberId, memberData) {
        // 입력값 검증
        const validatedMemberId = Member_zod_1.memberIdSchema.parse(memberId);
        const validatedMemberData = Member_zod_1.updateMemberSchema.parse(memberData);
        return this.client.put(`/members/${validatedMemberId}`, validatedMemberData);
    }
    /**
     * 특정 회원 정보를 조회합니다.
     * @param memberId 조회할 회원의 고유 ID
     * @returns 회원 정보가 담긴 Promise
     */
    async get(memberId) {
        // 입력값 검증
        const validatedMemberId = Member_zod_1.memberIdSchema.parse(memberId);
        return this.client.get(`/members/${validatedMemberId}`);
    }
    /**
     * 특정 회원을 삭제합니다.
     * @param memberId 삭제할 회원의 고유 ID
     * @returns 성공 시 내용이 없는 Promise
     */
    async delete(memberId) {
        // 입력값 검증
        const validatedMemberId = Member_zod_1.memberIdSchema.parse(memberId);
        return this.client.delete(`/members/${validatedMemberId}`);
    }
}
exports.MemberService = MemberService;
//# sourceMappingURL=Member.api.js.map