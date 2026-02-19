import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { RetryReconcileDto } from './dto/retry-reconcile.dto';
import { ReconcileService } from './reconcile.service';

@Controller('v1/admin')
export class ReconcileController {
  constructor(private readonly reconcileService: ReconcileService) {}

  @Post('intents/:intentId/reconcile/retry')
  async retryIntentReconcile(
    @Param('intentId') intentId: string,
    @Body() dto: RetryReconcileDto,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const data = await this.reconcileService.retryIntent(intentId, {
      reasonCode: dto.reasonCode,
      reasonMessage: dto.reasonMessage,
      actorId,
      correlationId,
    });

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('legs/:legId/reconcile/retry')
  async retryLegReconcile(
    @Param('legId') legId: string,
    @Body() dto: RetryReconcileDto,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const data = await this.reconcileService.retryLeg(legId, {
      reasonCode: dto.reasonCode,
      reasonMessage: dto.reasonMessage,
      actorId,
      correlationId,
    });

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
