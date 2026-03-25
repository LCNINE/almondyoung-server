import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, refunds, paymentIntents } from '../schema';
import { Refund } from '../types';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { GATEWAY_AGGREGATE_TYPE, GatewayEventType, buildRefundEventPayload } from '../messaging/gateway-event.builder';
import { CreateRefundDto } from './dto';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async create(dto: CreateRefundDto): Promise<Refund> {
    const charge = await this.chargesService.findById(dto.chargeId);
    if (!charge) {
      throw new NotFoundException({
        error: 'CHARGE_NOT_FOUND',
        message: `Charge not found: ${dto.chargeId}`,
      });
    }

    if (charge.status !== 'SUCCEEDED') {
      throw new BadRequestException({
        error: 'CHARGE_NOT_REFUNDABLE',
        message: `Charge is not in a refundable state: ${charge.status}`,
      });
    }

    if (dto.amount > charge.amount) {
      throw new BadRequestException({
        error: 'REFUND_AMOUNT_EXCEEDS_CHARGE',
        message: `Refund amount (${dto.amount}) exceeds charge amount (${charge.amount})`,
      });
    }

    const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
    if (!method) {
      throw new NotFoundException({
        error: 'PAYMENT_METHOD_NOT_FOUND',
        message: `Payment method not found: ${charge.paymentMethodId}`,
      });
    }

    const userId = await this.getIntentUserId(charge.intentId);
    if (!userId) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Intent not found for charge: ${charge.id}`,
      });
    }

    // Create refund record
    const insertedRefunds = await this.dbService.db
      .insert(refunds)
      .values({
        chargeId: charge.id,
        intentId: charge.intentId,
        amount: dto.amount,
        currency: charge.currency,
        status: 'PENDING',
        reasonCode: dto.reasonCode ?? null,
        reasonMessage: dto.reasonMessage ?? null,
        providerRefundId: null,
      })
      .returning();

    const refund = insertedRefunds[0];
    if (!refund) throw new Error('REFUND_INSERT_FAILED');

    const correlationId = `refund:${refund.id}:${Date.now()}`;
    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = `wallet:refund:${refund.id}`;

    let providerResult: Awaited<ReturnType<typeof provider.refund>>;
    try {
      providerResult = await provider.refund({
        refundId: refund.id,
        chargeId: charge.id,
        intentId: charge.intentId,
        userId,
        amount: dto.amount,
        currency: charge.currency,
        idempotencyKey,
        correlationId,
        reasonCode: dto.reasonCode,
        providerData: method.providerData,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Provider refund threw: refundId=${refund.id}, error=${message}`);
      await this.stateTransitionService.transitionRefund(refund.id, 'FAILED', {
        correlationId,
        reasonCode: 'PROVIDER_EXCEPTION',
        reasonMessage: message,
      });
      return this.findByIdOrThrow(refund.id);
    }

    const now = new Date().toISOString();

    if (providerResult.status === 'SUCCEEDED') {
      await this.dbService.db.transaction(async (tx) => {
        // Update refund → SUCCEEDED
        await tx
          .update(refunds)
          .set({
            status: 'SUCCEEDED',
            providerRefundId: providerResult.providerRefundId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, refund.id));

        // Record the transition with outbox event
        await this.stateTransitionService.transitionRefund(
          refund.id,
          'SUCCEEDED',
          {
            correlationId,
            reasonCode: 'REFUND_SUCCEEDED',
            outboxEvent: {
              eventType: GatewayEventType.REFUND_SUCCEEDED,
              aggregateType: GATEWAY_AGGREGATE_TYPE,
              aggregateId: refund.id,
              payload: buildRefundEventPayload({
                refundId: refund.id,
                chargeId: charge.id,
                intentId: charge.intentId,
                userId,
                status: 'SUCCEEDED',
                amount: dto.amount,
                currency: charge.currency,
                occurredAt: now,
              }),
            },
          },
          undefined,
          tx,
        );
      });
    } else if (providerResult.status === 'PENDING') {
      // Refund is processing asynchronously
      await this.dbService.db.update(refunds).set({ updatedAt: new Date() }).where(eq(refunds.id, refund.id));
    } else {
      // FAILED
      await this.stateTransitionService.transitionRefund(refund.id, 'FAILED', {
        correlationId,
        reasonCode: providerResult.errorCode ?? 'REFUND_FAILED',
        reasonMessage: providerResult.errorMessage,
      });
    }

    return this.findByIdOrThrow(refund.id);
  }

  async createByIntent(
    intentId: string,
    dto: { amount: number; reasonCode?: string; reasonMessage?: string },
  ): Promise<Refund[]> {
    const refundableCharges = await this.chargesService.findRefundableByIntent(intentId);
    if (refundableCharges.length === 0) {
      throw new NotFoundException({
        error: 'REFUNDABLE_CHARGE_NOT_FOUND',
        message: `No refundable charge found for intent: ${intentId}`,
      });
    }

    const totalAvailable = refundableCharges.reduce((s, c) => s + c.amount, 0);
    if (dto.amount > totalAvailable) {
      throw new BadRequestException({
        error: 'REFUND_AMOUNT_EXCEEDS_TOTAL',
        message: `Refund amount (${dto.amount}) exceeds total available (${totalAvailable})`,
      });
    }

    let remaining = dto.amount;
    const results: Refund[] = [];
    for (let i = 0; i < refundableCharges.length; i++) {
      const charge = refundableCharges[i];
      const isLast = i === refundableCharges.length - 1;
      const share = isLast ? remaining : Math.round(dto.amount * (charge.amount / totalAvailable));
      if (share <= 0) continue;
      const refund = await this.create({
        chargeId: charge.id,
        amount: share,
        reasonCode: dto.reasonCode,
        reasonMessage: dto.reasonMessage,
      });
      results.push(refund);
      remaining -= share;
    }
    return results;
  }

  async findByIdOrThrow(id: string): Promise<Refund> {
    const rows = await this.dbService.db.select().from(refunds).where(eq(refunds.id, id)).limit(1);

    const refund = rows[0];
    if (!refund) {
      throw new NotFoundException({
        error: 'REFUND_NOT_FOUND',
        message: `Refund not found: ${id}`,
      });
    }
    return refund;
  }

  private async getIntentUserId(intentId: string): Promise<string | null> {
    const rows = await this.dbService.db
      .select({ userId: paymentIntents.userId })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    return rows[0]?.userId ?? null;
  }
}
