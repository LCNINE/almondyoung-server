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
    // Medusa → 기존 서비스 데이터 변환 메서드
    static medusaToAuthorizePaymentDto(input: AuthorizePaymentInput): any {
        const sessionData = input.data || {};
        const invoiceId = sessionData.invoiceId as string;
        const paymentEventId = sessionData.paymentEventId as string;

        if (!invoiceId) {
            throw new Error("Payment Session에 필수 정보(invoiceId)가 없습니다.");
        }

        // 깔끔한 AuthorizePaymentDto 구조로 변환
        const result: any = {
            invoiceId: invoiceId,
        };

        // 결제 수단 정보가 있으면 포함
        if (sessionData.paymentMethods) {
            result.paymentMethods = sessionData.paymentMethods;
        } else if (sessionData.pointAmount) {
            result.pointAmount = sessionData.pointAmount;
        } else if (paymentEventId) {
            // 기본적으로 단일 결제수단으로 처리
            result.paymentMethodId = paymentEventId;
        }

        return result;
    }

    // Medusa → 캡처 요청 변환
    static medusaToCapturePaymentDto(input: CapturePaymentInput): any {
        const paymentEventId = input.data?.paymentEventId as string;
        const amount = (input.data as any)?.amount;

        if (!paymentEventId) {
            throw new Error("PaymentEvent ID가 필요합니다.");
        }

        const result: any = {
            paymentEventId: paymentEventId,
        };

        if (amount) {
            result.amount = amount;
        }

        return result;
    }

    // Medusa → 환불 요청 변환
    static medusaToRefundRequest(input: RefundPaymentInput): any {
        const paymentEventId = input.data?.paymentEventId as string;

        if (!paymentEventId) {
            throw new Error("PaymentEvent ID가 필요합니다.");
        }

        return {
            paymentEventId: paymentEventId,
            amount: input.amount,
            reason: "Refund initiated from Medusa"
        };
    }

    // 하위 호환성을 위한 기존 메서드 (deprecated) - 제거됨
    // 새로운 깔끔한 구조로 완전히 전환

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
    private readonly timeout: number;
    private readonly logger: any;

    constructor(options: { endpoint: string; logger: any; }) {
        this.endpoint = options.endpoint.replace(/\/$/, '');
        this.timeout = 30000; // 기본 타임아웃
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
                    'Content-Type': 'application/json'
                    // API 키 인증 제거 - 우리 시스템에서는 불필요
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
    static identifier = "almond-payment";

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
        // cart_id 대신 결제에 실제 필요한 정보만 추출
        const { amount, currency_code } = input;
        const customerId = (input.context as any)?.customer_id;

        this.logger_.info(`[initiatePayment] 새로운 결제 세션 생성: ${amount} ${currency_code || 'KRW'}`);

        try {
            // 1. Wallet 서비스에서 새로운 Invoice 생성 (cart_id 없이)
            const createInvoicePayload = {
                amount: amount,
                currency: currency_code || 'KRW',
                userId: customerId,
                metadata: {
                    source: 'MEDUSA'
                }
            };

            const invoiceResponse = await this.apiClient_.post('/invoices', createInvoicePayload);
            const invoiceId = invoiceResponse.invoiceId;

            // 2. 생성된 Invoice에 대한 결제 세션 생성
            const sessionResponse = await this.apiClient_.post(`/invoices/${invoiceId}/create-session`);
            const paymentEventId = sessionResponse.paymentEventId;

            this.logger_.info(`[initiatePayment] Invoice ${invoiceId}, PaymentEvent ${paymentEventId} 생성 완료`);

            return {
                id: paymentEventId, // Medusa PaymentSession의 고유 ID
                data: {
                    invoiceId: invoiceId,           // Wallet에서 생성한 실제 Invoice ID
                    paymentEventId: paymentEventId
                    // cart_id 완전히 제거
                }
            };
        } catch (error) {
            this.logger_.error(`[initiatePayment] Invoice 생성 실패: amount=${amount}`, error);
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
        this.logger_.info(`[capturePayment] 결제 캡처 시작: ${JSON.stringify(input.data)}`);

        try {
            // 새로운 데이터 변환 메서드 사용
            const capturePayload = PaymentDataTranslator.medusaToCapturePaymentDto(input);

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
            this.logger_.error(`[capturePayment] 결제 캡처 실패: ${error.message}`, error);
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
        this.logger_.info(`[refundPayment] 환불 처리 시작: ${JSON.stringify(input.data)}`);

        try {
            // 새로운 데이터 변환 메서드 사용
            const refundPayload = PaymentDataTranslator.medusaToRefundRequest(input);

            const result = await this.apiClient_.post('/refunds', refundPayload);

            this.logger_.info(`[refundPayment] 환불 처리 완료: ${refundPayload.paymentEventId}`);

            return {
                data: {
                    id: input.data?.id,
                    ...result
                }
            };
        } catch (error) {
            this.logger_.error(`[refundPayment] 환불 처리 실패: ${error.message}`, error);
            throw error;
        }
    }

    async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
        const paymentEventId = input.data?.paymentEventId as string;

        this.logger_.info(`[cancelPayment] 결제 취소 시작: paymentEventId=${paymentEventId}`);

        try {
            const result = await this.apiClient_.post(`/payments/${paymentEventId}/cancel`, {
                reason: "Cancelled from Medusa"
            });

            this.logger_.info(`[cancelPayment] 결제 취소 완료: paymentEventId=${paymentEventId}`);

            return {
                data: {
                    id: input.data?.id,
                    ...result
                }
            };
        } catch (error) {
            this.logger_.error(`[cancelPayment] 결제 취소 실패: paymentEventId=${paymentEventId}`, error);
            throw error;
        }
    }

    async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
        const paymentEventId = input.data?.paymentEventId as string;

        this.logger_.info(`[retrievePayment] 결제 정보 조회: paymentEventId=${paymentEventId}`);

        try {
            const result = await this.apiClient_.get(`/payments/events/${paymentEventId}`);

            this.logger_.info(`[retrievePayment] 결제 정보 조회 완료: paymentEventId=${paymentEventId}`);

            return {
                data: {
                    id: input.data?.id,
                    ...result.data
                }
            };
        } catch (error) {
            this.logger_.error(`[retrievePayment] 결제 정보 조회 실패: paymentEventId=${paymentEventId}`, error);
            throw error;
        }
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