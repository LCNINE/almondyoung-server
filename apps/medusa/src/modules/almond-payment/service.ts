import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import {
    InitiatePaymentInput, InitiatePaymentOutput,
    AuthorizePaymentInput, AuthorizePaymentOutput,
    CapturePaymentInput, CapturePaymentOutput,
    RefundPaymentInput, RefundPaymentOutput,
    CancelPaymentInput, CancelPaymentOutput,
    RetrievePaymentInput, RetrievePaymentOutput,
    UpdatePaymentInput, UpdatePaymentOutput,
    DeletePaymentInput, DeletePaymentOutput,
    GetPaymentStatusInput, GetPaymentStatusOutput,
    PaymentSessionStatus,
    ProviderWebhookPayload,
    WebhookActionResult
} from "@medusajs/framework/types"

import {
    AlmondPaymentOptions,
    AuthorizePaymentDto,
    CapturePaymentDto,
    PaymentAuthorizationResult,
    PaymentCaptureResult,
    ProcessPaymentDto,
    PaymentResponse as WalletPaymentResponse
} from "./types"

// 타입들은 types.ts에서 import하여 사용

/**
 * ======================================================
 * 데이터 번역기 클래스
 * ======================================================
 */
class PaymentDataTranslator {
    // 새로운 authorize API를 위한 변환 메서드
    static medusaToAuthorizePaymentDto(input: AuthorizePaymentInput): any {
        const sessionData = input.data || {};
        const invoiceId = sessionData.invoiceId as string;
        const paymentEventId = sessionData.paymentEventId as string;

        if (!invoiceId) {
            throw new Error("Payment Session에 필수 정보(invoiceId)가 없습니다.");
        }

        // 새로운 AuthorizePaymentDto 구조로 변환
        const result: any = {
            invoiceId: invoiceId,
        };

        // paymentEventId가 있으면 단일 결제수단으로 처리
        if (paymentEventId) {
            result.paymentMethodId = paymentEventId;
        }

        // 추가 결제 정보가 있으면 포함
        if (sessionData.paymentMethods) {
            result.paymentMethods = sessionData.paymentMethods;
        }

        if (sessionData.pointAmount) {
            result.pointAmount = sessionData.pointAmount;
        }

        return result;
    }

    // 하위 호환성을 위한 기존 메서드 (deprecated)
    static medusaToProcessPaymentDto(input: AuthorizePaymentInput): ProcessPaymentDto {
        const sessionData = input.data || {};
        const invoiceId = sessionData.invoiceId as string;
        const invoiceSessionId = sessionData.invoiceSessionId as string;

        if (!invoiceId || !invoiceSessionId) {
            throw new Error("Payment Session에 필수 정보(invoiceId, invoiceSessionId)가 없습니다.");
        }

        return {
            invoiceId,
            invoiceSessionId,
            payments: sessionData.payments as any || [{
                methodType: 'BNPL',
                paymentMethodId: sessionData.paymentMethodId as string,
            }],
        };
    }

    static paymentResultToMedusaAuthorize(result: any): AuthorizePaymentOutput {
        // 새로운 API 응답 구조 처리
        if (result.entityBody) {
            return {
                status: "authorized",
                data: {
                    id: result.entityId,
                    paymentEventId: result.entityBody.paymentEventId,
                    paymentStatus: result.entityBody.paymentStatus,
                    totalAmount: result.entityBody.totalAmount,
                    rawResponse: result,
                },
            };
        }

        // 기존 응답 구조 처리 (하위 호환성)
        const walletResponse = result as WalletPaymentResponse;
        return {
            status: "authorized",
            data: {
                id: walletResponse.paymentEventId,
                paymentEventId: walletResponse.paymentEventId,
                rawResponse: walletResponse,
            },
        };
    }

    static toMedusaStatus(almondStatus: string): PaymentSessionStatus {
        const statusMap: Record<string, PaymentSessionStatus> = {
            'AUTHORIZED': 'authorized',
            'CAPTURED': 'authorized', // Medusa에서는 'capture'라는 별도 액션이므로 일단 authorized로 둡니다.
            'FAILED': 'error',
            'PENDING': 'pending',
            'SETTLEMENT_REQUESTED': 'pending',
            'CANCELLED': 'canceled',
        };
        return statusMap[almondStatus] || 'pending';
    }
}


/**
 * ======================================================
 * API 통신 전담 클라이언트
 * ======================================================
 */
class AlmondApiClient {
    private readonly endpoint: string;
    private readonly apiKey: string;
    private readonly timeout: number;
    private readonly logger: any;

    constructor(options: { endpoint: string; apiKey: string; timeout?: number; logger: any; }) {
        this.endpoint = options.endpoint.replace(/\/$/, '');
        this.apiKey = options.apiKey;
        this.timeout = options.timeout || 30000;
        this.logger = options.logger;
    }

    private async request(method: 'POST' | 'GET' | 'PUT' | 'DELETE', path: string, body?: Record<string, any>): Promise<any> {
        const url = `${this.endpoint}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            this.logger?.info(`Almond API Request: ${method} ${url}`, body ? { body } : {});

            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            let responseBody;
            try {
                responseBody = await response.json();
            } catch (parseError) {
                // JSON 파싱 실패 시 텍스트로 처리
                const textResponse = await response.text();
                this.logger?.warn(`Failed to parse JSON response: ${textResponse}`);
                responseBody = { message: textResponse };
            }

            if (!response.ok) {
                const errorMessage = responseBody?.message || `HTTP Error: ${response.status} ${response.statusText}`;
                const error = new Error(errorMessage);
                (error as any).status = response.status;
                (error as any).response = responseBody;
                throw error;
            }

            this.logger?.info(`Almond API Success: ${method} ${url}`, { status: response.status });
            return responseBody;
        } catch (error) {
            clearTimeout(timeoutId);

            // 타임아웃 오류 처리
            if (error.name === 'AbortError') {
                const timeoutError = new Error(`Request timeout after ${this.timeout}ms`);
                (timeoutError as any).code = 'TIMEOUT_ERROR';
                (timeoutError as any).retryable = true;
                this.logger?.error(`Almond API TIMEOUT: ${method} ${url}`, timeoutError);
                throw timeoutError;
            }

            // 네트워크 오류 처리
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                const networkError = new Error(`Network error: Cannot connect to ${this.endpoint}`);
                (networkError as any).code = 'NETWORK_ERROR';
                (networkError as any).retryable = true;
                this.logger?.error(`Almond API NETWORK ERROR: ${method} ${url}`, networkError);
                throw networkError;
            }

            this.logger?.error(`Almond API FAILED: ${method} ${url}`, {
                error: error.message,
                status: (error as any).status,
                response: (error as any).response
            });
            throw error;
        }
    }
    public post(path: string, body: Record<string, any> = {}): Promise<any> { return this.request('POST', path, body); }
    public get(path: string): Promise<any> { return this.request('GET', path); }
    public put(path: string, body: Record<string, any> = {}): Promise<any> { return this.request('PUT', path, body); }
    public delete(path: string): Promise<any> { return this.request('DELETE', path); }
}


/**
 * ======================================================
 * 최종 Medusa Payment Provider 서비스
 * ======================================================
 */
class AlmondPaymentProviderService extends AbstractPaymentProvider<AlmondPaymentOptions> {
    async getWebhookActionAndData(data: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
        this.logger_.info(`[getWebhookActionAndData] 웹훅 데이터 수신: ${JSON.stringify(data)}`);

        try {
            // 웹훅 데이터에서 이벤트 타입과 결제 정보 추출
            const webhookData = data as any;
            const eventType = webhookData.eventType || webhookData.type;
            const paymentEventId = webhookData.paymentEventId || webhookData.payment_id;

            if (!eventType || !paymentEventId) {
                this.logger_.warn(`[getWebhookActionAndData] 필수 웹훅 데이터 누락: eventType=${eventType}, paymentEventId=${paymentEventId}`);
                return {
                    action: "not_supported",
                    data: {
                        session_id: "",
                        amount: 0
                    }
                };
            }

            // 이벤트 타입에 따른 액션 결정
            switch (eventType) {
                case 'payment.completed':
                case 'payment.captured':
                    return {
                        action: "authorized", // Medusa에서 지원하는 액션
                        data: {
                            session_id: paymentEventId,
                            amount: webhookData.amount || 0
                        }
                    };

                case 'payment.failed':
                    return {
                        action: "failed",
                        data: {
                            session_id: paymentEventId,
                            amount: webhookData.amount || 0
                        }
                    };

                case 'payment.refunded':
                    return {
                        action: "not_supported", // 환불은 별도 처리
                        data: {
                            session_id: paymentEventId,
                            amount: webhookData.amount || 0
                        }
                    };

                default:
                    this.logger_.warn(`[getWebhookActionAndData] 지원하지 않는 이벤트 타입: ${eventType}`);
                    return {
                        action: "not_supported",
                        data: {
                            session_id: "",
                            amount: 0
                        }
                    };
            }
        } catch (error) {
            this.logger_.error(`[getWebhookActionAndData] 웹훅 처리 실패:`, error);
            return {
                action: "not_supported",
                data: {
                    session_id: "",
                    amount: 0
                }
            };
        }
    }

    // 추후 웹훅 구현할것
    static identifier = "almond-payment-provider";

    protected readonly logger_: any;
    protected readonly options_: AlmondPaymentOptions;
    protected readonly apiClient_: AlmondApiClient;

    constructor(container: { logger: any }, options: AlmondPaymentOptions) {
        super(container, options);
        this.options_ = options;
        this.logger_ = container.logger;
        this.apiClient_ = new AlmondApiClient({ ...options, logger: this.logger_ });
    }

    async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
        const invoiceId = (input.context as any)?.cart_id;
        if (!invoiceId) {
            throw new Error("Context에 cart_id (invoiceId)가 없습니다.");
        }

        this.logger_.info(`[initiatePayment] 결제 세션 생성 시작: invoiceId=${invoiceId}`);

        try {
            // 기존 결제 서비스에서 PaymentEvent를 생성하여 세션 역할로 사용
            // invoiceSessionId 대신 PaymentEvent ID를 직접 사용하여 단순화
            const sessionResponse = await this.apiClient_.post(`/invoices/${invoiceId}/create-session`);

            // PaymentEvent ID를 세션 ID로 사용 (invoiceSessionId 제거)
            const paymentEventId = sessionResponse.paymentEventId || sessionResponse.invoiceSessionId;

            this.logger_.info(`[initiatePayment] 결제 세션 생성 완료: paymentEventId=${paymentEventId}`);

            return {
                id: paymentEventId, // Medusa PaymentSession의 고유 ID
                data: { // 다음 단계로 전달할 데이터 (단순화)
                    invoiceId: invoiceId,
                    paymentEventId: paymentEventId,
                }
            };
        } catch (error) {
            this.logger_.error(`[initiatePayment] 결제 세션 생성 실패: invoiceId=${invoiceId}`, error);
            throw new Error(`결제 세션 생성에 실패했습니다: ${error.message}`);
        }
    }

    async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
        this.logger_.info(`[authorizePayment] 결제 승인 시작: ${JSON.stringify(input.data)}`);

        try {
            // 새로운 AuthorizePaymentDto 구조로 변환
            const payload = PaymentDataTranslator.medusaToAuthorizePaymentDto(input);

            // 새로운 authorize API 호출
            const result = await this.apiClient_.post('/payments/authorize', payload);

            if (result.entityBody && result.entityBody.paymentEventId) {
                this.logger_.info(`[authorizePayment] 결제 승인 완료: ${result.entityBody.paymentEventId}`);
                return PaymentDataTranslator.paymentResultToMedusaAuthorize(result);
            }

            throw new Error(result.message || "Payment authorization failed");
        } catch (error) {
            this.logger_.error(`[authorizePayment] 결제 승인 실패: ${error.message}`, error);
            throw error;
        }
    }

    async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
        const paymentEventId = input.data?.paymentEventId as string;
        // CapturePaymentInput에는 amount 속성이 없으므로 data에서 가져오거나 생략
        const amount = (input.data as any)?.amount;

        this.logger_.info(`[capturePayment] 결제 캡처 시작: paymentEventId=${paymentEventId}, amount=${amount}`);

        try {
            // 실제 캡처 API 호출
            const capturePayload: any = {
                paymentEventId: paymentEventId,
            };

            if (amount) {
                capturePayload.amount = amount;
            }

            const result = await this.apiClient_.post('/payments/capture', capturePayload);

            if (result.entityBody) {
                this.logger_.info(`[capturePayment] 결제 캡처 완료: ${result.entityBody.paymentEventId}`);

                return {
                    data: {
                        id: result.entityId,
                        paymentEventId: result.entityBody.paymentEventId,
                        capturedAmount: result.entityBody.capturedAmount,
                        paymentStatus: result.entityBody.paymentStatus,
                        rawResponse: result
                    }
                };
            }

            throw new Error("Capture response format is invalid");
        } catch (error) {
            this.logger_.error(`[capturePayment] 결제 캡처 실패: paymentEventId=${paymentEventId}`, error);
            throw error;
        }
    }

    async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
        // authorizePayment 또는 다른 메서드에서 반환된 data가 input.data로 전달됩니다.
        const paymentEventId = input.data?.id as string;
        const result = await this.apiClient_.get(`/payments/events/${paymentEventId}`);
        const medusaStatus = PaymentDataTranslator.toMedusaStatus(result.data.status);
        return { status: medusaStatus };
    }

    async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
        const paymentEventId = input.data?.paymentEventId as string;
        const payload = {
            paymentEventId,
            amount: input.amount,
            reason: "Refund initiated from Medusa"
        };
        const result = await this.apiClient_.post('/refunds', payload);
        return { data: { id: input.data?.id, ...result } };
    }

    async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
        const paymentEventId = input.data?.paymentEventId as string;
        const result = await this.apiClient_.post(`/payments/${paymentEventId}/cancel`, { reason: "Cancelled from Medusa" });
        return { data: { id: input.data?.id, ...result } };
    }

    async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
        const paymentEventId = input.data?.paymentEventId as string;
        const result = await this.apiClient_.get(`/payments/events/${paymentEventId}`);
        return { data: { id: input.data?.id, ...result.data } };
    }

    async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
        this.logger_.info("updatePayment called, but no corresponding action is defined.");
        return { data: input.data }; // 받은 데이터를 그대로 반환
    }

    async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
        this.logger_.info("deletePayment called, but no corresponding action is defined.");
        return {}; // 빈 객체 반환
    }
}

export default AlmondPaymentProviderService;