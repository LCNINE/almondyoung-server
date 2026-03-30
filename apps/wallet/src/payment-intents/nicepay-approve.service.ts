import { createHash } from 'crypto';
import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge, PaymentIntent } from '../types';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from './auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { NicepayAuthService } from '../providers/nicepay/nicepay-auth.service';

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class NicepayApproveService {
  private readonly logger = new Logger(NicepayApproveService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly nicepayAuth: NicepayAuthService,
  ) {}

  async approve(
    intentId: string,
    tid: string,
    orderId: string,
    amount: number,
    authToken: string,
    clientId: string,
    signature: string,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(`approve called: intentId=${intentId} tid=${tid} orderId=${orderId} amount=${amount}`);

    // 1. 서명 검증: hex(sha256(authToken + clientId + amount + secretKey))
    const secretKey = process.env.NICEPAY_SECRET_KEY ?? '';
    const expectedSignature = sha256hex(`${authToken}${clientId}${amount}${secretKey}`);
    if (signature !== expectedSignature) {
      throw new UnprocessableEntityException({
        error: 'NICEPAY_INVALID_SIGNATURE',
        message: 'Signature mismatch — possible tampering detected',
      });
    }

    // 2. REQUIRES_ACTION AUTHORIZE charge 조회
    const charge = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE');
    if (!charge || charge.status !== 'REQUIRES_ACTION') {
      throw new UnprocessableEntityException({
        error: 'NO_REQUIRES_ACTION_CHARGE',
        message: 'No pending NicePay action found for this intent',
      });
    }

    // 3. 금액 검증
    if (charge.amount !== amount) {
      this.logger.error(`Amount mismatch: charge.amount=${charge.amount} nicepay.amount=${amount}`);
      throw new UnprocessableEntityException({
        error: 'NICEPAY_AMOUNT_MISMATCH',
        message: `Expected amount ${charge.amount}, received ${amount}`,
      });
    }

    // 4. orderId 검증 (chargeId 대시 제거 = orderId)
    const expectedOrderId = charge.id.replace(/-/g, '');
    if (orderId !== expectedOrderId) {
      throw new UnprocessableEntityException({
        error: 'NICEPAY_ORDER_ID_MISMATCH',
        message: 'orderId does not match the charge',
      });
    }

    // 5. 나이스페이 승인 API 호출: POST /v1/payments/{tid}
    const authorization = await this.nicepayAuth.getAuthHeader();
    const res = await fetch(`https://api.nicepay.co.kr/v1/payments/${tid}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount }),
    });

    const data = await res.json().catch(() => ({}));
    this.logger.log(`NicePay approval API response: resultCode=${data.resultCode}`);

    if (!res.ok || data.resultCode !== '0000') {
      this.logger.error(`NicePay approval failed: ${JSON.stringify(data)}`);
      await this.finalizeFailure(charge, data.resultCode ?? 'NICEPAY_APPROVAL_FAILED', correlationId);
      throw new UnprocessableEntityException({
        error: data.resultCode ?? 'NICEPAY_APPROVAL_FAILED',
        message: data.resultMsg ?? 'NicePay approval failed',
      });
    }

    await this.finalizeApproval(charge, tid, correlationId);
  }

  async finalizeApproval(charge: Charge, tid: string, correlationId: string): Promise<void> {
    const intent = await this.loadIntent(charge.intentId);
    const now = new Date().toISOString();

    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(charge.id, 'SUCCEEDED', { providerTransactionId: tid }, tx);

      await this.stateTransitionService.transitionIntent(
        intent.id,
        'AUTHORIZED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_SUCCEEDED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_AUTHORIZED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId ?? '',
              status: 'AUTHORIZED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
              extra: { medusa_session_id: intent.metadata?.medusa_session_id },
            }),
          },
        },
        undefined,
        tx,
      );
    });

    await this.autoCaptureService.attemptAutoCapture(charge.intentId, correlationId);
  }

  async finalizeFailure(charge: Charge, errorCode: string, correlationId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'FAILED',
        {
          errorCode,
          errorMessage: `NicePay payment failed: ${errorCode}`,
        },
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        charge.intentId,
        'CREATED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_FAILED',
          reasonMessage: errorCode,
        },
        undefined,
        tx,
      );
    });
  }

  private async loadIntent(intentId: string): Promise<PaymentIntent> {
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    return intent;
  }
}
