"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClientFactory = void 0;
const index_1 = require("../index");
const MockHmsAPI_1 = require("./MockHmsAPI");
/**
 * 환경에 따라 실제 API 또는 목업 API를 제공하는 팩토리 클래스
 */
class ApiClientFactory {
    /**
     * 설정에 따라 적절한 API 클라이언트를 생성합니다.
     *
     * @param config API 클라이언트 설정
     * @returns HmsAPI 또는 MockHmsAPI 인스턴스
     */
    static create(config) {
        // 연산자 우선순위 괄호 추가
        const useMock = config.useMock ??
            (process.env.USE_MOCK === "true" ||
                process.env.NODE_ENV === "development");
        if (useMock) {
            // 목업서버 URL 설정 (기본값: http://localhost:3005)
            const mockServerUrl = config.mockServerUrl || "http://localhost:3005";
            process.env.MOCK_SERVER_URL = mockServerUrl;
            console.log(`🔧 MockHmsAPI를 사용합니다. (서버: ${mockServerUrl})`);
            return new MockHmsAPI_1.MockHmsAPI(config);
        }
        else {
            console.log("🚀 실제 HmsAPI를 사용합니다.");
            return new index_1.HmsAPI({
                swKey: config.swKey,
                custKey: config.custKey,
                isTest: !!config.isTest,
                timeout: config.timeout
            });
        }
    }
    /**
     * 환경 변수만으로 API 클라이언트를 생성합니다.
     *
     * @returns HmsAPI 또는 MockHmsAPI 인스턴스
     */
    static createFromEnv() {
        const config = {
            swKey: process.env.SW_KEY || "",
            custKey: process.env.CUST_KEY || "",
            isTest: process.env.NODE_ENV !== "production",
            timeout: parseInt(process.env.API_TIMEOUT || "30000"),
            useMock: process.env.USE_MOCK === "true",
            mockServerUrl: process.env.MOCK_SERVER_URL,
        };
        return this.create(config);
    }
}
exports.ApiClientFactory = ApiClientFactory;
//# sourceMappingURL=ApiClientFactory.js.map