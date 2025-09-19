import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { PaymentIntentService } from './intents/intent.service';
import { PaymentError } from '../providers/payment-provider.interface';
import { getTsid } from 'tsid-ts';
import { sql } from 'drizzle-orm';

// `checkout_sessions` 테이블에 대한 타입 (스키마 파일에서 가져오는 것을 권장)

@Injectable()
export class CheckoutSessionService {
  private readonly logger = new Logger(CheckoutSessionService.name);
  // ✨ [수정] 우리 서비스의 결제 UI 기본 URL. 실제로는 ConfigService 등을 통해 주입받아야 합니다.
  private readonly WALLET_UI_BASE_URL =
    process.env.WALLET_UI_BASE_URL || 'http://localhost:8000/kr/payment';

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly intentService: PaymentIntentService,
  ) {}

  /**
   * [수정] 범용 Checkout Session을 생성하고,
   * 사용자가 리다이렉션될 우리 서비스의 자체 결제 UI URL을 반환합니다.
   * 이 단계에서는 특정 결제 제공업체(PG)에 종속되지 않습니다.
   * @param intentId - 결제 의도 ID
   * @param options - 결제 완료/취소 시 복귀할 최종 URL
   */
  async createCheckoutSession(
    intentId: string,
    options: {
      returnUrl: string;
      cancelUrl: string;
      metadata?: Record<string, any>;
    },
  ) {
    // ... (intent 조회 로직은 동일)
    const metadata = options.metadata || {};
    const sessionId = `cs_${getTsid().toString()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const paymentUiUrl = `${this.WALLET_UI_BASE_URL}?sessionId=${sessionId}`;

    // 1. 삽입할 데이터를 먼저 객체로 만듭니다.
    const newSessionData: any = {
      // 타입 추론을 위해 any 또는 별도 타입 사용
      id: sessionId,
      intentId: intentId,
      redirectUrl: paymentUiUrl,
      returnUrl: options.returnUrl,
      cancelUrl: options.cancelUrl,
      status: 'PENDING' as const,
      expiresAt,
      metadata: sql`default`,
      createdAt: sql`default`,
    };

    // 2. metadata 객체에 실제 값이 있을 때만 newSessionData에 추가합니다.
    if (Object.keys(metadata).length > 0) {
      newSessionData.metadata = metadata;
    }

    // 3. 최종적으로 만들어진 객체를 .values()에 전달합니다.
    // 이제 metadata가 비어있으면 이 객체에 metadata 키 자체가 없게 됩니다.
    await this.db.db.insert(schema.checkoutSessions).values(newSessionData);

    this.logger.log(
      `✅ Checkout Session 생성됨: ${sessionId} (Intent: ${intentId})`,
    );

    return {
      sessionId: sessionId,
      paymentUrl: paymentUiUrl,
    };
  }
}
