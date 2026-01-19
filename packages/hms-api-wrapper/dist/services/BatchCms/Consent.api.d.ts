import { HttpClient } from "../../utils/HttpClient.service";
import { AbstractService } from "../index";
import { AgreementFileResponseDto } from "./types";
export declare class ConsentService extends AbstractService {
    constructor(client: HttpClient);
    /**
     * 동의자료 파일을 등록합니다.
     * @param custId 고객사 ID (URL 경로에 포함)
     * @param memberId 회원 ID
     * @param fileInput 등록할 파일 데이터와 파일명
     * @returns 등록된 동의자료 정보
     */
    register(custId: string, memberId: string, fileInput: {
        file: Buffer | Blob;
        filename: string;
    }): Promise<AgreementFileResponseDto>;
    /**
     * 등록된 동의자료 정보를 조회합니다.
     * @param custId 고객사 ID
     * @param agreementKey 동의자료 등록 시 받은 고유 키
     * @returns 조회된 동의자료 정보
     */
    get(custId: string, agreementKey: string): Promise<AgreementFileResponseDto>;
}
