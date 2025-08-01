import {
  AbstractPaymentProvider,
  PaymentSessionStatus,
} from '@medusajs/framework/utils';
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from '@medusajs/framework/types';
import { createApiHeaders } from './types';

// --- Helper Functions and Types ---

type AlmondPaymentSession = {
  id: string;
  status:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'FAILED'
    | 'CANCELLED'
    | 'REFUNDED';
  payment_url: string;
  expires_at: string;
  requires_authentication?: boolean;
  authentication_url?: string;
};

type AlmondApiError = {
  error: {
    type: string;
    message: string;
  };
};

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 500,
};

async function executeWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await apiCall();
    } catch (error) {
      attempt++;
      if (
        (error instanceof TypeError ||
          (error.cause && error.cause.code === 'ECONNRESET')) &&
        attempt <= RETRY_CONFIG.maxRetries
      ) {
        const delay =
          RETRY_CONFIG.baseDelay *
          Math.pow(2, attempt - 1) *
          (0.5 + Math.random() * 0.5);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

// --- Payment Provider Implementation ---

class AlmondPaymentProviderService extends AbstractPaymentProvider {
  getWebhookActionAndData(
    data: ProviderWebhookPayload['payload'],
  ): Promise<WebhookActionResult> {
    throw new Error('Method not implemented.');
  }
  static identifier = 'almond-payment';

  protected readonly apiUrl_: string;
  protected readonly logger_: any;
  private readonly pollingInterval = 2000;

  constructor(container: { logger: any }, options: { apiUrl: string }) {
    super(container, options);
    this.apiUrl_ = options.apiUrl || 'http://localhost:9001';
    this.logger_ = container.logger;
  }

  /**
   * TODO:  Payment Collection의 ID는 pay_col_로, Payment Session의 ID는 payses_로 시작하는 규칙이 있습니다.
   * 외부 결제 모듈(예: wallet )을 연동할 때도 이런 ID 규칙을 반드시 따라야 할까요?
   */
  async initiatePayment({
    amount,
    currency_code,
    data,
    context,
  }: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    try {
      const payload = {
        amount: amount,
        currency: currency_code,
        metadata: {
          customer_id: context?.customer?.id,
          email: context?.customer?.email,
          billing_address: context?.customer?.billing_address,
        },
        expires_in_minutes: 30,
      };

      const response = await executeWithRetry(async () => {
        const res = await fetch(`${this.apiUrl_}/payment-sessions`, {
          method: 'POST',
          headers: createApiHeaders(context),
          body: JSON.stringify(payload),
        });

        if (res.status >= 400 && res.status < 500) {
          const errorData: AlmondApiError = await res.json();
          throw new Error(
            `[AlmondPayment] Payment session creation failed (HTTP ${res.status}): ${errorData.error.message}`,
          );
        }

        if (!res.ok) {
          throw new Error(`[AlmondPayment] Server error (HTTP ${res.status})`);
        }

        return res;
      });

      const paymentSession: AlmondPaymentSession = await response.json();

      return {
        id: paymentSession.id,
        data: {
          payment_session_id: paymentSession.id,
          payment_url: paymentSession.payment_url,
          expires_at: paymentSession.expires_at,
          currency_code: currency_code,
          should_poll: true,
          poll_interval: this.pollingInterval,
        },
      };
    } catch (error) {
      this.logger_.error('Failed to initiate payment:', error);
      throw error;
    }
  }

  async getPaymentStatus({
    data,
  }: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const sessionId = data?.payment_session_id as string;
    if (!sessionId) {
      throw new Error('Payment session ID not found in data.');
    }

    try {
      const response = await fetch(
        `${this.apiUrl_}/payment-sessions/${sessionId}`,
      );

      if (!response.ok) {
        this.logger_.warn(
          `Failed to fetch payment status for ${sessionId}. Status: ${response.status}`,
        );
        return { status: PaymentSessionStatus.ERROR, data };
      }

      const session: AlmondPaymentSession = await response.json();
      const statusMap: Record<
        AlmondPaymentSession['status'],
        PaymentSessionStatus
      > = {
        PENDING: PaymentSessionStatus.PENDING,
        AUTHORIZED: PaymentSessionStatus.AUTHORIZED,
        CAPTURED: PaymentSessionStatus.CAPTURED,
        FAILED: PaymentSessionStatus.ERROR,
        CANCELLED: PaymentSessionStatus.CANCELED,
        REFUNDED: PaymentSessionStatus.CANCELED,
      };

      return {
        status: statusMap[session.status] || PaymentSessionStatus.PENDING,
        data: {
          ...data,
          requires_action: session.requires_authentication,
          authentication_url: session.authentication_url,
        },
      };
    } catch (error) {
      this.logger_.error(
        `Error getting payment status for ${sessionId}:`,
        error,
      );
      return { status: PaymentSessionStatus.ERROR, data };
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    return this.getPaymentStatus(input);
  }

  async capturePayment({
    data,
    context,
  }: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const sessionId = data?.payment_session_id as string;

    try {
      // 먼저 현재 상태 확인
      const statusResponse = await fetch(
        `${this.apiUrl_}/payment-sessions/${sessionId}`,
      );
      if (statusResponse.ok) {
        const currentSession: AlmondPaymentSession =
          await statusResponse.json();

        // 이미 캡처된 경우 추가 처리 없이 반환
        if (currentSession.status === 'CAPTURED') {
          this.logger_.info(`Payment session ${sessionId} is already captured`);
          return { data: { ...data, status: 'CAPTURED' } };
        }
      }

      const response = await executeWithRetry(async () => {
        const res = await fetch(
          `${this.apiUrl_}/payment-sessions/${sessionId}/capture`,
          {
            method: 'POST',
            headers: createApiHeaders(context),
          },
        );

        // 이미 캡처된 경우 성공으로 처리
        if (res.status === 400) {
          const errorData = await res.json();
          if (errorData.message?.includes('already captured')) {
            return {
              ok: true,
              json: () => Promise.resolve({ status: 'CAPTURED' }),
            };
          }
        }

        if (!res.ok)
          throw new Error(`Capture failed with status ${res.status}`);
        return res;
      });

      const session: AlmondPaymentSession = await response.json();
      return { data: { ...data, ...session } };
    } catch (error) {
      this.logger_.error(`Failed to capture payment for ${sessionId}:`, error);

      // 캡처 실패 시 현재 상태 다시 확인
      try {
        const statusResponse = await fetch(
          `${this.apiUrl_}/payment-sessions/${sessionId}`,
        );
        if (statusResponse.ok) {
          const currentSession: AlmondPaymentSession =
            await statusResponse.json();
          if (currentSession.status === 'CAPTURED') {
            this.logger_.info(
              `Payment session ${sessionId} was captured despite API error`,
            );
            return { data: { ...data, status: 'CAPTURED' } };
          }
        }
      } catch (statusError) {
        this.logger_.warn(
          `Failed to check status after capture error:`,
          statusError,
        );
      }

      throw error;
    }
  }

  async refundPayment({
    amount,
    data,
    context,
  }: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const sessionId = data?.payment_session_id as string;
    const currencyCode = data?.currency_code as string;

    try {
      const response = await executeWithRetry(async () => {
        const res = await fetch(
          `${this.apiUrl_}/payment-sessions/${sessionId}/refund`,
          {
            method: 'POST',
            headers: createApiHeaders(context),
            body: JSON.stringify({
              amount: amount,
              currency: currencyCode,
            }),
          },
        );
        if (!res.ok) throw new Error(`Refund failed with status ${res.status}`);
        return res;
      });

      const result = await response.json();
      return { data: { ...data, refund_id: result.refund_id } };
    } catch (error) {
      this.logger_.error(`Failed to refund payment for ${sessionId}:`, error);
      throw error;
    }
  }

  async cancelPayment({
    data,
    context,
  }: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const sessionId = data?.payment_session_id as string;
    if (!sessionId) return { data };

    try {
      await executeWithRetry(async () => {
        const res = await fetch(
          `${this.apiUrl_}/payment-sessions/${sessionId}/cancel`,
          {
            method: 'POST',
            headers: createApiHeaders(context),
          },
        );
        if (!res.ok) throw new Error(`Cancel failed with status ${res.status}`);
        return res;
      });
    } catch (error) {
      this.logger_.error(`Failed to cancel payment for ${sessionId}:`, error);
    }

    return { data };
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return {};
  }

  async retrievePayment(
    input: RetrievePaymentInput,
  ): Promise<RetrievePaymentOutput> {
    const status = await this.getPaymentStatus(input);
    return { data: status.data };
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data };
  }
}

export default AlmondPaymentProviderService;
