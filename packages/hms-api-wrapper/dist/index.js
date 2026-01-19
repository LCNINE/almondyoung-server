"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HmsAPI = void 0;
const PaymentProfile_1 = require("./services/PaymentProfile");
const BatchCms_1 = require("./services/BatchCms");
const HttpClient_service_1 = require("./utils/HttpClient.service");
const PaymentTransaction_1 = require("./services/PaymentTransaction");
class HmsAPI {
    constructor(options) {
        this.httpClient = new HttpClient_service_1.HttpClient({
            swKey: options.swKey,
            custKey: options.custKey,
            isTest: options.isTest || false,
            timeout: options.timeout,
            baseURL: options.baseURL, // baseURL 전달
        });
    }
    get paymentProfiles() {
        if (!this._paymentProfileService) {
            this._paymentProfileService = new PaymentProfile_1.PaymentProfileService(this.httpClient);
        }
        return this._paymentProfileService;
    }
    get paymentTransactions() {
        // ✅ 수정: _paymentTransactionService
        if (!this._paymentTransactionService) {
            // ✅ 수정: _paymentTransactionService
            this._paymentTransactionService = new PaymentTransaction_1.PaymentTransactionService(this.httpClient);
        }
        // ✅ 수정: _paymentTransactionService
        return this._paymentTransactionService;
    }
    get members() {
        if (!this._memberService) {
            this._memberService = new BatchCms_1.MemberService(this.httpClient);
        }
        return this._memberService;
    }
    get agreements() {
        if (!this._consentService) {
            // 동의자료 서비스는 다른 Base URL을 사용
            const config = this.httpClient.getConfig();
            // 사용자가 baseURL을 지정했다면 그것을 사용, 아니면 기본 동의자료 URL 사용
            let consentBaseURL;
            if (config.baseURL) {
                consentBaseURL = config.baseURL;
            }
            else if (config.isTest) {
                consentBaseURL = "https://add-test.hyosungcms.co.kr/v1";
            }
            else {
                consentBaseURL = "https://add.hyosungcms.co.kr/v1";
            }
            const consentHttpClient = new HttpClient_service_1.HttpClient({
                swKey: config.swKey,
                custKey: config.custKey,
                isTest: config.isTest,
                timeout: config.timeout,
                baseURL: consentBaseURL,
            });
            this._consentService = new BatchCms_1.ConsentService(consentHttpClient);
        }
        return this._consentService;
    }
    get withdrawals() {
        if (!this._withdrawalService) {
            // 출금 서비스는 기존 Base URL을 사용 (api-test.hyosungcms.co.kr)
            this._withdrawalService = new BatchCms_1.WithdrawalService(this.httpClient);
        }
        return this._withdrawalService;
    }
    get cashReceipts() {
        if (!this._cashReceiptService) {
            // 현금영수증 서비스는 기존 Base URL을 사용 (api-test.hyosungcms.co.kr)
            this._cashReceiptService = new BatchCms_1.CashReceiptService(this.httpClient);
        }
        return this._cashReceiptService;
    }
}
exports.HmsAPI = HmsAPI;
// Mock 관련 export
__exportStar(require("./mock"), exports);
//# sourceMappingURL=index.js.map