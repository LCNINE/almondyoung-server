import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ChargesService } from '../charges/charges.service';
import { TossApproveService } from '../payment-intents/toss-approve.service';
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
  ) {}

  async handle(dto: TossWebhookBodyDto): Promise<void> {
    if (dto.eventType !== 'PAYMENT_STATUS_CHANGED') return;
    await this.handlePaymentStatusChanged(dto);
  }

  private async handlePaymentStatusChanged(dto: TossWebhookBodyDto): Promise<void> {
    const orderId = dto.data.orderId as string;
    const tossStatus = dto.data.status as string;
    const paymentKey = dto.data.paymentKey as string;
    const totalAmount = dto.data.totalAmount as number;

    // 1. 중복 제거
    const providerEventId = `${orderId}:${tossStatus}`;
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

    // 2. orderId → chargeId 복원
    const chargeId = rehydrateUuid(orderId);
    if (!chargeId) {
      this.logger.warn(`Invalid orderId format: ${orderId}`);
      await this.repository.updateStatus(receiptId, 'FAILED', { errorCode: 'INVALID_ORDER_ID' });
      return;
    }

    // 3. charge 조회
    const charge = await this.chargesService.findById(chargeId);
    if (!charge || charge.operation !== 'AUTHORIZE') {
      this.logger.log(`Charge not found or not AUTHORIZE: chargeId=${chargeId}`);
      await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
      return;
    }

    // 4. status별 처리 (인프라 에러는 throw → 500)
    const correlationId = `webhook:toss:${charge.intentId}:${Date.now()}`;

    if (tossStatus === 'DONE') {
      if (charge.status !== 'REQUIRES_ACTION') {
        this.logger.log(`Charge already processed: chargeId=${chargeId} status=${charge.status}`);
        await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
        return;
      }
      if (charge.amount !== totalAmount) {
        this.logger.error(
          `Amount mismatch: charge.amount=${charge.amount} toss.totalAmount=${totalAmount} chargeId=${chargeId}`,
        );
        await this.repository.updateStatus(receiptId, 'FAILED', {
          errorCode: 'AMOUNT_MISMATCH',
          errorMessage: `charge.amount=${charge.amount} toss.totalAmount=${totalAmount}`,
        });
        return;
      }
      await this.tossApproveService.finalizeApproval(charge, paymentKey, correlationId);
      await this.repository.updateStatus(receiptId, 'PROCESSED', { processedAt: new Date() });
    } else if (['ABORTED', 'EXPIRED', 'CANCELED'].includes(tossStatus)) {
      if (charge.status !== 'REQUIRES_ACTION') {
        this.logger.log(`Charge already processed: chargeId=${chargeId} status=${charge.status}`);
        await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
        return;
      }
      await this.tossApproveService.finalizeFailure(charge, tossStatus, correlationId);
      await this.repository.updateStatus(receiptId, 'PROCESSED', { processedAt: new Date() });
    } else {
      this.logger.log(`Unhandled toss status: ${tossStatus} for chargeId=${chargeId}`);
      await this.repository.updateStatus(receiptId, 'IGNORED_DUPLICATE');
    }
  }
}
