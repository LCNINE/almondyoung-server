import { Injectable, Logger } from '@nestjs/common';
import { CaptureService } from './capture.service';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ProviderRegistry } from '../providers/provider.registry';

@Injectable()
export class AutoCaptureService {
  private readonly logger = new Logger(AutoCaptureService.name);

  constructor(
    private readonly captureService: CaptureService,
    private readonly chargesService: ChargesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async attemptAutoCapture(intentId: string, correlationId: string): Promise<void> {
    try {
      const authorizeCharges =
        await this.chargesService.findAllSucceededAuthorizeByIntent(intentId);

      if (authorizeCharges.length === 0) return;

      const providerTypes: string[] = [];
      for (const charge of authorizeCharges) {
        const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
        if (!method) return;
        providerTypes.push(method.type);
      }

      if (!this.providerRegistry.shouldAutoCapture(providerTypes)) {
        this.logger.debug(
          `Auto-capture skipped for intent ${intentId}: not all providers support autoCapture`,
        );
        return;
      }

      this.logger.log(`Auto-capture triggered for intent ${intentId}`);
      await this.captureService.capture(intentId, correlationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Auto-capture failed for intent ${intentId}, manual capture still possible: ${msg}`,
      );
    }
  }
}
