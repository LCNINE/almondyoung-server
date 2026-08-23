import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ChargesService } from '../charges/charges.service';
import { TossApproveService } from '../payment-intents/toss-approve.service';
import { BillingMethodService } from '../billing/billing-method.service';
import { TossApiClient } from '../providers/toss/toss-api.client';
import { TossWebhookRepository } from './toss-webhook.repository';
import { TossWebhookBodyDto } from './dto';

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function rehydrateUuid(orderId: string): string | null {
  if (!/^[0-9a-f]{32}$/i.test(orderId)) return null;
  return [
    orderId.slice(0, 8),
    orderId.slice(8, 12),
    orderId.slice(12, 16),
    orderId.slice(16, 20),
    orderId.slice(20),
  ].join('-');
}

@Injectable()
export class TossWebhookService {
  private readonly logger = new Logger(TossWebhookService.name);

  constructor(
    private readonly repository: TossWebhookRepository,
    private readonly chargesService: ChargesService,
    private readonly tossApproveService: TossApproveService,
    private readonly billingMethodService: BillingMethodService,
    private readonly tossApi: TossApiClient,
  ) {}

  async handle(dto: TossWebhookBodyDto): Promise<void> {
    if (dto.eventType === 'PAYMENT_STATUS_CHANGED') {
      await this.handlePaymentStatusChanged(dto);
      return;
    }

    if (dto.eventType === 'BILLING_DELETED') {
      await this.handleBillingDeleted(dto);
      return;
    }
  }

  private async handleBillingDeleted(dto: TossWebhookBodyDto): Promise<void> {
    const billingKey = dto.data.billingKey as string;
    if (!billingKey) {
      this.logger.warn('BILLING_DELETED webhook missing billingKey');
      return;
    }

    const providerEventId = `billing_deleted:${billingKey}`;
    const { inserted, id: receiptId } = await this.repository.insertOrIgnore({
      providerType: 'TOSS',
      providerEventId,
      payloadHash: sha256hex(JSON.stringify(dto)),
      status: 'RECEIVED',
      receivedAt: new Date(),
    });

    if (!inserted) {
      this.logger.log(`Duplicate BILLING_DELETED webhook ignored: billingKey=${billingKey}`);
      return;
    }

    try {
      await this.billingMethodService.handleBillingDeletedWebhook(billingKey);
      await this.repository.updateStatus(receiptId, 'PROCESSED', { processedAt: new Date() });
    } catch (e: any) {
      this.logger.error(`Failed to handle BILLING_DELETED: ${e.message}`);
      await this.repository.updateStatus(receiptId, 'FAILED', {
        errorCode: 'BILLING_DELETED_HANDLING_FAILED',
        errorMessage: e.message,
      });
    }
  }

  private async handlePaymentStatusChanged(dto: TossWebhookBodyDto): Promise<void> {
    // 웹훅 본문은 인증되지 않은 값이다(토스는 HMAC 서명을 제공하지 않는다). orderId 만 charge 를
    // 찾는 데 쓰고, status/금액/paymentKey 는 토스에 재조회한 값(authoritative)으로 판단한다.
    const orderId = dto.data.orderId as string;

    // 1. orderId → chargeId 복원 (형식 오류는 재시도 가치가 없음)
    const chargeId = rehydrateUuid(orderId);
    if (!chargeId) {
      this.logger.warn(`Invalid orderId format: ${orderId}`);
      const { id: receiptId } = await this.repository.insertOrIgnore({
        providerType: 'TOSS',
        providerEventId: `${orderId}:INVALID`,
        payloadHash: sha256hex(JSON.stringify(dto)),
        status: 'RECEIVED',
        receivedAt: new Date(),
      });
      await this.repository.updateStatus(receiptId, 'FAILED', { errorCode: 'INVALID_ORDER_ID' });
      return;
    }

    // 2. charge 조회 (외부 호출 전이라 여기서 걸러지면 재조회 비용도 안 든다)
    const charge = await this.chargesService.findById(chargeId);
    if (!charge || charge.operation !== 'AUTHORIZE') {
      this.logger.log(`Charge not found or not AUTHORIZE: chargeId=${chargeId}`);
      return;
    }

    // 3. 토스 재조회 — dedup 삽입 *앞*에서 한다. 일시적 실패(5xx)로 throw 해도 dedup 행이
    //    남지 않아야 토스 재전송이 다시 처리될 수 있다(dedup 이 재시도를 영구 차단하는 사고 방지).
    const query = await this.tossApi.getPaymentByOrderId(orderId);
    if (!query.ok) {
      // 5xx/429 는 일시적 → throw(500) → 토스 재전송. 4xx(미존재 등)는 재시도 무의미 → 기록만.
      if (query.statusCode >= 500 || query.statusCode === 429) {
        throw new Error(`Toss re-query failed transiently for orderId=${orderId}: ${query.error.code}`);
      }
      this.logger.error(`Toss re-query not found for orderId=${orderId}: ${query.error.code}`);
      const { id: receiptId } = await this.repository.insertOrIgnore({
        providerType: 'TOSS',
        providerEventId: `${orderId}:NOT_FOUND`,
        payloadHash: sha256hex(JSON.stringify(dto)),
        status: 'RECEIVED',
        receivedAt: new Date(),
      });
      await this.repository.updateStatus(receiptId, 'FAILED', {
        errorCode: 'PAYMENT_NOT_FOUND',
        errorMessage: `Toss re-query failed: ${query.error.code}`,
      });
      return;
    }

    const authStatus = query.data.status;
    const authAmount = query.data.totalAmount;
    const authPaymentKey = query.data.paymentKey;

    // 4. VA secret 대조 — 토스가 문서화한 가상계좌 웹훅 인증. 발급 시 charge 에 저장해 둔 secret 과
    //    본문 secret 이 *있는데* 다르면 위조로 보고 거부한다. 본문에 secret 이 없으면 재조회에
    //    맡긴다(일부 이벤트에 secret 이 없을 수 있어, 정상 입금을 오차단하지 않기 위함).
    //    dedup *앞*에서 한다 — 위조 웹훅이 `orderId:DONE` dedup 키를 소모해 뒤이어 오는 진짜
    //    토스 웹훅을 중복으로 무시시키지 않도록, 전용 키로 기록한다.
    const storedSecret = (charge.responsePayload as { secret?: string } | null)?.secret;
    const bodySecret = typeof dto.data.secret === 'string' ? dto.data.secret : undefined;
    if (storedSecret && bodySecret !== undefined && bodySecret !== storedSecret) {
      this.logger.error(`Toss webhook secret mismatch: chargeId=${chargeId} orderId=${orderId}`);
      const { id: mismatchReceiptId } = await this.repository.insertOrIgnore({
        providerType: 'TOSS',
        providerEventId: `${orderId}:SECRET_MISMATCH`,
        payloadHash: sha256hex(JSON.stringify(dto)),
        status: 'RECEIVED',
        receivedAt: new Date(),
      });
      await this.repository.updateStatus(mismatchReceiptId, 'FAILED', {
        errorCode: 'SECRET_MISMATCH',
        errorMessage: 'Webhook secret does not match the one stored at virtual-account issuance',
      });
      return;
    }

    // 5. 중복 제거 (authoritative status 로 키를 만든다)
    const providerEventId = `${orderId}:${authStatus}`;
    const { inserted, id: receiptId } = await this.repository.insertOrIgnore({
      providerType: 'TOSS',
      providerEventId,
      payloadHash: sha256hex(JSON.stringify(dto)),
      status: 'RECEIVED',
      receivedAt: new Date(),
    });
    if (!inserted) {
      this.logger.log(`Duplicate webhook ignored: providerEventId=${providerEventId}`);
      return;
    }

    // 6. authoritative status 별 처리 (인프라 에러는 throw → 500)
    const correlationId = `webhook:toss:${charge.intentId}:${Date.now()}`;

    if (authStatus === 'DONE') {
      if (charge.status === 'CANCELED') {
        // 취소된 계좌에 실제 입금이 들어왔다(재조회로 확인됨) = 돈은 받았는데 주문이 없는 상태.
        // IGNORED_DUPLICATE 로 흘리면 아무도 모르게 묻히므로(실제 사고 발생) FAILED 로 남긴다.
        this.logger.error(
          `Deposit on canceled charge: chargeId=${chargeId} intentId=${charge.intentId} paymentKey=${authPaymentKey} amount=${authAmount}`,
        );
        await this.repository.updateStatus(receiptId, 'FAILED', {
          errorCode: 'DEPOSIT_ON_CANCELED_CHARGE',
          errorMessage: `취소된 charge 에 입금 발생: paymentKey=${authPaymentKey} amount=${authAmount}`,
        });
        return;
      }
      if (charge.status !== 'REQUIRES_ACTION') {
        this.logger.log(`Charge already processed: chargeId=${chargeId} status=${charge.status}`);
        await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
        return;
      }
      if (charge.amount !== authAmount) {
        this.logger.error(
          `Amount mismatch: charge.amount=${charge.amount} toss.totalAmount=${authAmount} chargeId=${chargeId}`,
        );
        await this.repository.updateStatus(receiptId, 'FAILED', {
          errorCode: 'AMOUNT_MISMATCH',
          errorMessage: `charge.amount=${charge.amount} toss.totalAmount=${authAmount}`,
        });
        return;
      }
      // 본문이 아닌 토스가 돌려준 실제 paymentKey 로 확정한다(가짜 키가 charge 에 박혀
      // 이후 취소/환불이 깨지는 것도 함께 방지).
      await this.tossApproveService.finalizeApproval(charge, authPaymentKey, correlationId);
      await this.repository.updateStatus(receiptId, 'PROCESSED', { processedAt: new Date() });
    } else if (['ABORTED', 'EXPIRED', 'CANCELED'].includes(authStatus)) {
      if (charge.status !== 'REQUIRES_ACTION') {
        this.logger.log(`Charge already processed: chargeId=${chargeId} status=${charge.status}`);
        await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
        return;
      }
      await this.tossApproveService.finalizeFailure(charge, authStatus, correlationId);
      await this.repository.updateStatus(receiptId, 'PROCESSED', { processedAt: new Date() });
    } else {
      // WAITING_FOR_DEPOSIT 등 — 위조된 DONE 은 재조회에서 여기로 떨어져 승인되지 않는다.
      this.logger.log(`Unhandled authoritative toss status: ${authStatus} for chargeId=${chargeId}`);
      await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
    }
  }
}
