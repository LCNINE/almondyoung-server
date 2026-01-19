"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsentService = void 0;
const index_1 = require("../index");
const Consent_zod_1 = require("./Consent.zod");
const CashReceipt_zod_1 = require("./CashReceipt.zod");
class ConsentService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    /**
     * 동의자료 파일을 등록합니다.
     * @param custId 고객사 ID (URL 경로에 포함)
     * @param memberId 회원 ID
     * @param fileInput 등록할 파일 데이터와 파일명
     * @returns 등록된 동의자료 정보
     */
    async register(custId, memberId, fileInput) {
        // 입력값 검증
        const validatedCustId = CashReceipt_zod_1.custIdSchema.parse(custId);
        const validatedData = Consent_zod_1.fullRegisterAgreementSchema.parse({
            memberId,
            file: fileInput.file,
            filename: fileInput.filename,
        });
        // FormData 객체 생성
        const formData = new FormData();
        // memberId 추가
        formData.append("memberId", validatedData.memberId);
        // 파일 추가 - Buffer를 Blob으로 변환
        let fileBlob;
        if (Buffer.isBuffer(validatedData.file)) {
            // Node.js Buffer를 Uint8Array로 변환한 후 Blob 생성
            const uint8Array = new Uint8Array(validatedData.file);
            fileBlob = new Blob([uint8Array], { type: "application/octet-stream" });
        }
        else {
            fileBlob = validatedData.file;
        }
        formData.append("file", fileBlob, validatedData.filename);
        // multipart/form-data로 POST 요청
        // Content-Type은 HttpClient에서 자동으로 처리됨
        return this.client.post(`/custs/${validatedCustId}/agreements`, formData);
    }
    /**
     * 등록된 동의자료 정보를 조회합니다.
     * @param custId 고객사 ID
     * @param agreementKey 동의자료 등록 시 받은 고유 키
     * @returns 조회된 동의자료 정보
     */
    async get(custId, agreementKey) {
        // 입력값 검증
        const validatedCustId = CashReceipt_zod_1.custIdSchema.parse(custId);
        const validatedAgreementKey = Consent_zod_1.agreementKeySchema.parse(agreementKey);
        return this.client.get(`/custs/${validatedCustId}/agreements/${validatedAgreementKey}`);
    }
}
exports.ConsentService = ConsentService;
//# sourceMappingURL=Consent.api.js.map