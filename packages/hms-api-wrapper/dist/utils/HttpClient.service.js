"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = exports.HsFmsError = void 0;
const axios_1 = __importDefault(require("axios"));
// 효성 FMS 에러 응답 타입 (문서에 명시된 형식)
// 커스텀 에러 클래스
class HsFmsError extends Error {
    constructor(error) {
        super(error.message);
        this.error = error;
        this.name = "HsFmsError";
    }
}
exports.HsFmsError = HsFmsError;
class HttpClient {
    getConfig() {
        return this.config;
    }
    constructor(config) {
        if (!config.swKey)
            throw new Error("swKey is required");
        if (!config.custKey)
            throw new Error("custKey is required");
        this.config = {
            ...config,
            timeout: config.timeout || 30000, // 기본값 30초
        };
        // baseURL 결정 로직
        let baseURL;
        if (config.baseURL) {
            baseURL = config.baseURL;
        }
        else if (config.isTest) {
            baseURL = "https://add-test.hyosungcms.co.kr/v1";
        }
        else {
            baseURL = "https://add.hyosungcms.co.kr/v1";
        }
        this.client = axios_1.default.create({
            baseURL,
            timeout: this.config.timeout,
            headers: {
                Authorization: `VAN ${config.swKey}:${config.custKey}`,
                "Content-Type": "application/json",
                charset: "UTF-8",
            },
        });
        this.setupInterceptors();
    }
    // 효성 공통 에러 객체
    setupInterceptors() {
        this.client.interceptors.response.use((response) => response, (error) => {
            if (error.response) {
                const fmsError = {
                    message: error.response.data.error?.message || "Unknown error",
                    developerMessage: error.response.data.error?.developerMessage || error.message,
                };
                throw new HsFmsError(fmsError);
            }
            throw error;
        });
    }
    async get(url, config) {
        return this.client.get(url, config).then((response) => response.data);
    }
    async post(url, data, config) {
        // FormData 처리를 위한 특별한 로직
        if (data && typeof data === 'object' && data.constructor.name === 'FormData') {
            // undici FormData를 axios가 처리할 수 있도록 설정
            const formDataConfig = {
                ...config,
                headers: {
                    ...config?.headers,
                    // Content-Type을 제거하여 axios가 자동으로 multipart boundary를 설정하도록 함
                    'Content-Type': undefined,
                },
            };
            return this.client
                .post(url, data, formDataConfig)
                .then((response) => response.data);
        }
        return this.client
            .post(url, data, config)
            .then((response) => response.data);
    }
    async put(url, data, config) {
        return this.client
            .put(url, data, config)
            .then((response) => response.data);
    }
    async delete(url, config) {
        return this.client.delete(url, config).then((response) => response.data);
    }
    async request(config) {
        try {
            const response = await this.client.request({
                ...config,
                headers: {
                    ...config.headers,
                    // 인증 헤더는 axios 인스턴스 생성 시 이미 설정되어 있으므로
                    // 여기서 다시 설정할 필요가 없습니다.
                    // 만약 특정 요청에만 다른 헤더를 써야 한다면 유지해야 합니다.
                    // 하지만 현재 구조에서는 중복으로 보입니다.
                    // Authorization: `VAN ${this.config.swKey}:${this.config.custKey}`,
                    // "Content-Type": "application/json",
                    // charset: "UTF-8",
                },
            });
            return response.data;
        }
        catch (error) {
            if (error.response?.data?.error) {
                const fmsError = {
                    message: error.response.data.error.message || "Unknown error",
                    developerMessage: error.response.data.error.developerMessage || error.message,
                };
                throw new HsFmsError(fmsError);
            }
            throw error;
        }
    }
}
exports.HttpClient = HttpClient;
//# sourceMappingURL=HttpClient.service.js.map