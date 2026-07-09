import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge } from '../types';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ChargesService } from '../charges/charges.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly chargesService: ChargesService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async capture(intentId: string, correlationId: string): Promise<void> {
    // Find all SUCCEEDED AUTHORIZE charges (ordered by createdAt asc; POINTS always first)
    const authorizeCharges = await this.chargesService.findAllSucceededAuthorizeByIntent(intentId);

    if (authorizeCharges.length === 0) {
      throw new UnprocessableEntityException({
        error: 'NO_AUTHORIZE_CHARGE',
        message: `No succeeded AUTHORIZE charge found for intent: ${intentId}`,
      });
    }

    const intentInfo = await this.getIntentInfo(intentId);
    if (!intentInfo) {
      throw new UnprocessableEntityException({
        error: 'INTENT_NOT_FOUND',
        message: `Intent not found: ${intentId}`,
      });
    }
    const userId = intentInfo.userId ?? '';

    const results: { charge: Charge; succeeded: boolean }[] = [];

    for (const authorizeCharge of authorizeCharges) {
      const succeeded = await this.captureOneLeg(authorizeCharge, userId, intentId, correlationId);
      results.push({ charge: authorizeCharge, succeeded });
    }

    const succeededCount = results.filter((r) => r.succeeded).length;
    const totalCount = results.length;

    const now = new Date().toISOString();
    const totalCaptured = authorizeCharges.reduce((s, c) => s + c.amount, 0);

    if (succeededCount === totalCount) {
      // All succeeded → CAPTURED
      await this.stateTransitionService.transitionIntent(intentId, 'CAPTURED', {
        correlationId,
        reasonCode: 'CAPTURE_SUCCEEDED',
        outboxEvent: {
          eventType: GatewayEventType.INTENT_CAPTURED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId,
            status: 'CAPTURED',
            payableAmount: totalCaptured,
            currency: authorizeCharges[0].currency,
            occurredAt: now,
            // 무통장(가상계좌) 웹훅 자동확인 등 비동기 캡처에서도 후속 도메인이 결제 종류를
            // 식별할 수 있도록 intent.metadata 를 전파한다 (membership 컨슈머가 type=MEMBERSHIP_FEE 로 필터).
            extra: { metadata: intentInfo.metadata ?? null },
          }),
        },
      });
    } else if (succeededCount > 0) {
      // Partial success → PARTIALLY_CAPTURED + 운영 알림
      await this.stateTransitionService.transitionIntent(intentId, 'PARTIALLY_CAPTURED', {
        correlationId,
        reasonCode: 'CAPTURE_PARTIAL',
        reasonMessage: `${succeededCount}/${totalCount} charges captured successfully. Manual resolution required.`,
        outboxEvent: {
          eventType: 'payment.intent.partially_captured',
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId,
            status: 'PARTIALLY_CAPTURED',
            payableAmount: totalCaptured,
            currency: authorizeCharges[0].currency,
            occurredAt: now,
            extra: {
              succeededCount,
              totalCount,
              failedChargeIds: results.filter((r) => !r.succeeded).map((r) => r.charge.id),
            },
          }),
        },
      });

      this.logger.error(
        `PARTIALLY_CAPTURED: intentId=${intentId}, succeeded=${succeededCount}/${totalCount}. Manual resolution required.`,
      );
    } else {
      // 전 leg 실패. AUTHORIZED(돈 확정)에서 FAILED는 불법 전이 + 오보고이므로 전이하지 않고 에러만 올린다(수동 해소).
      this.logger.error(
        `CAPTURE_ALL_FAILED: intentId=${intentId}, 0/${totalCount} captured. Intent는 AUTHORIZED로 유지(수동 해소 필요).`,
      );
      throw new UnprocessableEntityException({
        error: 'CAPTURE_ALL_FAILED',
        message: `All ${totalCount} capture attempts failed for intent ${intentId}. Manual resolution required.`,
      });
    }
  }

  private async captureOneLeg(
    authorizeCharge: Charge,
    userId: string,
    intentId: string,
    correlationId: string,
  ): Promise<boolean> {
    const method = await this.paymentMethodsService.findById(authorizeCharge.paymentMethodId);
    if (!method) {
      this.logger.error(`Payment method not found for charge: ${authorizeCharge.id}`);
      return false;
    }

    // 결정론적 멱등키 — 재시도/동시 실행 시 재INSERT(23505) 대신 기존 charge 재사용
    const idempotencyKey = this.chargesService.generateIdempotencyKey(authorizeCharge.id, 'CAPTURE');
    let captureCharge = await this.chargesService.findByProviderIdempotencyKey(idempotencyKey);
    if (captureCharge?.status === 'SUCCEEDED') {
      return true; // 이미 캡처됨 — 멱등 skip
    }
    if (!captureCharge) {
      try {
        captureCharge = await this.chargesService.create({
          intentId,
          paymentMethodId: method.id,
          amount: authorizeCharge.amount,
          currency: authorizeCharge.currency,
          operation: 'CAPTURE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, authorizeChargeId: authorizeCharge.id },
        });
      } catch (err) {
        if ((err as { code?: string })?.code !== '23505') throw err;
        // 동시 INSERT 경쟁 → 기존 row 재사용
        captureCharge = await this.chargesService.findByProviderIdempotencyKey(idempotencyKey);
        if (!captureCharge) throw err;
        if (captureCharge.status === 'SUCCEEDED') return true;
      }
    }

    const provider = this.providerRegistry.getProviderOrThrow(method.type);

    let providerResult: Awaited<ReturnType<typeof provider.capture>>;
    try {
      providerResult = await provider.capture({
        chargeId: authorizeCharge.id,
        intentId,
        paymentMethodId: method.id,
        userId,
        amount: captureCharge.amount,
        currency: captureCharge.currency,
        idempotencyKey: captureCharge.providerIdempotencyKey,
        correlationId,
        providerData: method.providerData,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Provider capture threw: intentId=${intentId}, authorizeChargeId=${authorizeCharge.id}, error=${msg}`,
      );
      await this.chargesService.updateStatus(captureCharge.id, 'FAILED', {
        errorCode: 'PROVIDER_EXCEPTION',
        errorMessage: msg,
      });
      return false;
    }

    if (providerResult.status === 'SUCCEEDED') {
      await this.chargesService.updateStatus(captureCharge.id, 'SUCCEEDED', {
        providerTransactionId:
          providerResult.providerTransactionId ?? authorizeCharge.providerTransactionId ?? undefined,
        responsePayload: providerResult.raw,
        // 재시도로 기존 FAILED charge 를 재사용해 성공한 경우 과거 실패 사유를 지운다
        errorCode: null,
        errorMessage: null,
      });
      return true;
    } else {
      await this.chargesService.updateStatus(captureCharge.id, 'FAILED', {
        errorCode: providerResult.errorCode ?? 'CAPTURE_FAILED',
        errorMessage: providerResult.errorMessage ?? 'Capture failed',
        responsePayload: providerResult.raw,
      });
      return false;
    }
  }

  private async getIntentInfo(
    intentId: string,
  ): Promise<{ userId: string | null; metadata: Record<string, unknown> } | null> {
    const rows = await this.dbService.db
      .select({ userId: paymentIntents.userId, metadata: paymentIntents.metadata })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, metadata: row.metadata };
  }
}
