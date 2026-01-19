import { HttpClient } from "../../utils/HttpClient.service";
import { AbstractService } from "../index";
import { CreateMemberRequestDto, CreateMemberResponseDto, UpdateMemberRequestDto } from "./types";
export declare class MemberService extends AbstractService {
    constructor(client: HttpClient);
    /**
     * 신규 회원을 등록합니다.
     * @param memberData 등록할 회원 정보
     * @returns API 응답 결과. `response.member.result` 객체를 통해 실제 성공 여부를 확인해야 합니다.
     */
    create(memberData: CreateMemberRequestDto): Promise<CreateMemberResponseDto>;
    /**
     * 회원을 수정하거나, 존재하지 않을 경우 신규 등록(Upsert)합니다.
     *
     * @param memberId 대상 회원의 ID
     * @param memberData 수정할 회원 정보. 결제정보(paymentCompany 등 4개 필드)는 전부 포함하거나 전부 제외해야 합니다.
     * @returns API 응답 결과. `response.member.result` 객체를 통해 실제 성공 여부를 확인해야 합니다.
     */
    update(memberId: string, memberData: UpdateMemberRequestDto): Promise<CreateMemberResponseDto>;
    /**
     * 특정 회원 정보를 조회합니다.
     * @param memberId 조회할 회원의 고유 ID
     * @returns 회원 정보가 담긴 Promise
     */
    get(memberId: string): Promise<CreateMemberResponseDto>;
    /**
     * 특정 회원을 삭제합니다.
     * @param memberId 삭제할 회원의 고유 ID
     * @returns 성공 시 내용이 없는 Promise
     */
    delete(memberId: string): Promise<void>;
}
