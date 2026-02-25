import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge } from '../types';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ChargesService } from '../charges/charges.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';

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
    const authorizeCharges =
      await this.chargesService.findAllSucceededAuthorizeByIntent(intentId);

    if (authorizeCharges.length === 0) {
      throw new UnprocessableEntityException({
        error: 'NO_AUTHORIZE_CHARGE',
        message: `No succeeded AUTHORIZE charge found for intent: ${intentId}`,
      });
    }

    const userId = await this.getIntentUserId(intentId);
    if (!userId) {
      throw new UnprocessableEntityException({
        error: 'INTENT_NOT_FOUND',
        message: `Intent not found: ${intentId}`,
      });
    }

    for (const authorizeCharge of authorizeCharges) {
      await this.captureOneLeg(authorizeCharge, userId, intentId, correlationId);
    }
  }

  private async captureOneLeg(
    authorizeCharge: Charge,
    userId: string,
    intentId: string,
    correlationId: string,
  ): Promise<void> {
    const method = await this.paymentMethodsService.findById(
      authorizeCharge.paymentMethodId,
    );
    if (!method) {
      this.logger.error(
        `Payment method not found for charge: ${authorizeCharge.id}`,
      );
      return;
    }

    const captureCharge = await this.chargesService.create({
      intentId,
      paymentMethodId: method.id,
      amount: authorizeCharge.amount,
      currency: authorizeCharge.currency,
      operation: 'CAPTURE',
      status: 'CREATED',
      providerIdempotencyKey: this.chargesService.generateIdempotencyKey(
        authorizeCharge.id,
        'CAPTURE',
      ),
      requestPayload: { intentId, authorizeChargeId: authorizeCharge.id },
    });

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
        providerData: method.providerData as Record<string, unknown>,
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
      return;
    }

    if (providerResult.status === 'SUCCEEDED') {
      await this.chargesService.updateStatus(captureCharge.id, 'SUCCEEDED', {
        providerTransactionId: providerResult.providerTransactionId,
        responsePayload: providerResult.raw,
      });
    } else {
      await this.chargesService.updateStatus(captureCharge.id, 'FAILED', {
        errorCode: providerResult.errorCode ?? 'CAPTURE_FAILED',
        errorMessage: providerResult.errorMessage ?? 'Capture failed',
        responsePayload: providerResult.raw,
      });
    }
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
