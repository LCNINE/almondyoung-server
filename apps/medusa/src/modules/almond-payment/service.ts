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

type ModuleOptions = {
  apiKey: string;
};

class AlmondPaymentProviderService extends AbstractPaymentProvider {
  getWebhookActionAndData(
    data: ProviderWebhookPayload['payload'],
  ): Promise<WebhookActionResult> {
    throw new Error('Method not implemented.');
  }
  static identifier = 'almond-payment';

  protected readonly logger_: any;
  protected options_: ModuleOptions;
  private readonly pollingInterval = 2000;

  constructor(container: { logger: any }, options: ModuleOptions) {
    super(container, options);
    this.options_ = options || {
      apiKey:
        process.env.ALMOND_PAYMENT_API_ENDPOINT || 'http://localhost:9001',
    };
    this.logger_ = container.logger;
  }

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

      // 실제 API 호출 코드 (주석 처리)
      /*
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
      */

      // 목업 데이터로 대체
      const mockPaymentSession: AlmondPaymentSession = {
        id: `mock_payment_${Date.now()}`,
        status: 'PENDING',
        payment_url: 'http://localhost:8000/wallet',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        requires_authentication: false,
      };

      // 실제 API 호출 대신 목업 데이터 사용
      this.logger_.info('[AlmondPayment] Using mock data:', {
        payload,
        mockResponse: mockPaymentSession,
      });

      // return {
      //   id: mockPaymentSession.id,
      //   data: {
      //     payment_session_id: paymentSession.id,
      //     payment_url: paymentSession.payment_url,
      //     expires_at: paymentSession.expires_at,
      //     currency_code: currency_code,
      //     should_poll: true,
      //     poll_interval: this.pollingInterval,
      //   },
      // };

      return {
        id: mockPaymentSession.id,
        data: {
          payment_session_id: mockPaymentSession.id,
          payment_url: mockPaymentSession.payment_url,
          expires_at: mockPaymentSession.expires_at,
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

  /**
   *  이 코드 의문
   *  1. authorizePayment()가 getPaymentStatus를 호출하고 있음
   *  2. 근데 authorizePayment()는 paymentKey를 받아서 윌렛에 결제 승인요청을 해야하는건데 그런 코드로직이 없는거같음
   *  3. 아직 미흡한 부분인거같음
   *  4. retrievePayment() 에서도 getPaymentStatus()를 호출하고있는데
   *  5. 그러면 getPaymentStatus()의 파라미터로 paymentKey가 들어오는 경우와, 단순히 payment_session_id만 들어오는 경우가 있는데
   *  6. 이거 두개 구분해서 처리해줘야하는거 아닌가 싶음
   *  7. 이 모든걸 종합해봤을 때, authorizePayment()변경이 필요한거같음
   *  8. 어떤 사용자가 결제를 요청했는지같은 정보가 필요할지도 고려해봐야함, 필요하다면 authorizePayment() 파라미터에 아몬드영 user.id를 받아야할수도있음
   *  9. 왜냐면, 메두사는 아몬드영의 토큰을 모름 (정확하게는 cookie에 아몬드영, 메두사 각각의 토큰이 저장되어있긴하지만, 이 쿠키를 가지고 현재 로그인한 사용자가 누구인지를 백엔드쪽에서 판별하기보다는
   *     프론트 측에서 판별해서 user_id만 넘겨주는게 더 좋은 방법인거같다는 생각이 듦 )
   */

  /**
   *  추가로, Stripe의 결제 처리 방식이 그럼 뭐길래 메두사 깃헙 코드 stripe-base에서
   *  왜 authorizePayment() => getPaymentStatus() 흐름으로 작성되어있는건지 의문이 들어서 검색해보고 찾아보니,
   *  stripe는 프론트에서 이미 결제 완료하고 , 백엔드는 단순히 상태 확인만 하는 방식이라서 그런거같음
   *  근데 아몬드는 프론트에서 결제 요청하고 백엔드는 결제 승인요청을 해야하는데 그런 로직이 없음
   *  그래서 authorizePayment() 이거 커스텀해야함
   */
  async getPaymentStatus({
    data,
  }: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const sessionId = data?.payment_session_id as string;
    if (!sessionId) {
      throw new Error('Payment session ID not found in data.');
    }

    try {
      const response = await fetch(
        `${this.options_.apiKey}/payment-sessions/${sessionId}`,
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

  /*
    이 코드는 관리자가 결제 캡쳐를 수동으로 진행 할 때 사용되는것으로 보임 
  */
  async capturePayment({
    data,
    context,
  }: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // payment_session_id
    const sessionId = data?.id as string;

    try {
      // 먼저 현재 상태 확인
      const statusResponse = await fetch(
        `${this.options_.apiKey}/payment-sessions/${sessionId}`,
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
          `${this.options_.apiKey}/payment-sessions/${sessionId}/capture`,
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
          `${this.options_.apiKey}/payment-sessions/${sessionId}`,
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
          `${this.options_.apiKey}/payment-sessions/${sessionId}/refund`,
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
          `${this.options_.apiKey}/payment-sessions/${sessionId}/cancel`,
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
