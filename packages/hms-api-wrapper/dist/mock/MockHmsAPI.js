"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockHmsAPI = void 0;
const HttpClient_service_1 = require("../utils/HttpClient.service");
const index_1 = require("../services/index");
// Mock HttpClient - 실제 API 대신 목업서버로 요청
class MockHttpClient extends HttpClient_service_1.HttpClient {
    constructor(config) {
        super(config);
        this.mockBaseURL = process.env.MOCK_SERVER_URL || "http://localhost:3005";
    }
    async get(url) {
        const response = await fetch(`${this.mockBaseURL}${url}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || "Mock API Error");
        }
        return response.json();
    }
    async post(url, data, config) {
        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
        };
        if (data instanceof FormData) {
            // FormData인 경우 (파일 업로드)
            options.headers = {}; // Content-Type 제거 (브라우저가 자동 설정)
            options.body = data;
        }
        else if (data) {
            options.body = JSON.stringify(data);
        }
        const response = await fetch(`${this.mockBaseURL}${url}`, options);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || "Mock API Error");
        }
        return response.json();
    }
    async put(url, data) {
        const response = await fetch(`${this.mockBaseURL}${url}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: data ? JSON.stringify(data) : undefined,
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || "Mock API Error");
        }
        return response.json();
    }
    async delete(url) {
        const response = await fetch(`${this.mockBaseURL}${url}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || "Mock API Error");
        }
        return response.json();
    }
}
// Mock Member Service
class MockMemberService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    async create(memberData) {
        return this.client.post("/v1/members", memberData);
    }
    async update(memberId, memberData) {
        return this.client.put(`/v1/members/${memberId}`, memberData);
    }
    async get(memberId) {
        return this.client.get(`/v1/members/${memberId}`);
    }
    async delete(memberId) {
        return this.client.delete(`/v1/members/${memberId}`);
    }
}
// Mock Consent Service
class MockConsentService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    async register(custId, memberId, fileInput) {
        const formData = new FormData();
        formData.append("memberId", memberId);
        let fileBlob;
        if (Buffer.isBuffer(fileInput.file)) {
            fileBlob = new Blob([fileInput.file], {
                type: "application/octet-stream",
            });
        }
        else {
            fileBlob = fileInput.file;
        }
        formData.append("file", fileBlob, fileInput.filename);
        return this.client.post(`/v1/custs/${custId}/agreements`, formData);
    }
    async get(custId, agreementKey) {
        return this.client.get(`/v1/custs/${custId}/agreements/${agreementKey}`);
    }
}
// Mock Withdrawal Service
class MockWithdrawalService extends index_1.AbstractService {
    constructor(client) {
        super(client);
    }
    async request(params) {
        return this.client.post("/v1/payments/cms", params);
    }
    async get(transactionId) {
        return this.client.get(`/v1/payments/cms/${transactionId}`);
    }
    async update(transactionId, params) {
        return this.client.put(`/v1/payments/cms/${transactionId}`, params);
    }
    async delete(transactionId) {
        return this.client.delete(`/v1/payments/cms/${transactionId}`);
    }
    async list(query) {
        const queryParams = new URLSearchParams();
        if (query) {
            if ("fromPaymentDate" in query && query.fromPaymentDate) {
                queryParams.append("fromPaymentDate", query.fromPaymentDate);
            }
            if ("toPaymentDate" in query && query.toPaymentDate) {
                queryParams.append("toPaymentDate", query.toPaymentDate);
            }
            if ("memberId" in query && query.memberId) {
                queryParams.append("memberId", query.memberId);
            }
            if ("memberName" in query && query.memberName) {
                queryParams.append("memberName", query.memberName);
            }
            if ("pageNumber" in query && query.pageNumber) {
                queryParams.append("pageNumber", query.pageNumber.toString());
            }
            if ("pageSize" in query && query.pageSize) {
                queryParams.append("pageSize", query.pageSize.toString());
            }
        }
        const queryString = queryParams.toString();
        const url = queryString
            ? `/v1/payments/cms?${queryString}`
            : "/v1/payments/cms";
        return this.client.get(url);
    }
}
// Mock HmsAPI - 실제 HmsAPI와 동일한 인터페이스
class MockHmsAPI {
    constructor(options) {
        this.httpClient = new MockHttpClient({
            swKey: options.swKey,
            custKey: options.custKey,
            isTest: options.isTest || false,
            timeout: options.timeout,
        });
    }
    get members() {
        if (!this._memberService) {
            this._memberService = new MockMemberService(this.httpClient);
        }
        return this._memberService;
    }
    get agreements() {
        if (!this._consentService) {
            this._consentService = new MockConsentService(this.httpClient);
        }
        return this._consentService;
    }
    get withdrawals() {
        if (!this._withdrawalService) {
            this._withdrawalService = new MockWithdrawalService(this.httpClient);
        }
        return this._withdrawalService;
    }
    // 실제 HmsAPI에는 없지만 목업서버 상태 확인용
    async healthCheck() {
        return this.httpClient.get("/health");
    }
}
exports.MockHmsAPI = MockHmsAPI;
//# sourceMappingURL=MockHmsAPI.js.map