import { Injectable } from '@nestjs/common';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
import { CreateIntentDto } from './dto/create-intent.dto';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import { PaymentIntent, PaymentLeg } from '../types';
import {
  ExpireIntentsBatchResult,
  IntentTerminationResult,
  LegOperationResult,
  RefundRequestDetailResult,
} from './application/intents.service.types';
import { IntentCreationService } from './application/intent-creation.service';
import { LegExecutionService } from './application/leg-execution.service';
import { IntentTerminationService } from './application/intent-termination.service';
import { RefundOrchestrationService } from './application/refund-orchestration.service';

@Injectable()
export class IntentsService {
  constructor(
    private readonly intentCreationService: IntentCreationService,
    private readonly legExecutionService: LegExecutionService,
    private readonly intentTerminationService: IntentTerminationService,
    private readonly refundOrchestrationService: RefundOrchestrationService,
  ) {}

  async createIntent(
    dto: CreateIntentDto,
    correlationId?: string,
  ): Promise<PaymentIntent> {
    return this.intentCreationService.createIntent(dto, correlationId);
  }

  async getIntent(intentId: string): Promise<PaymentIntent> {
    return this.intentCreationService.getIntent(intentId);
  }

  async configureLegs(
    intentId: string,
    dto: ConfigureLegsDto,
    correlationId?: string,
  ): Promise<PaymentLeg[]> {
    return this.intentCreationService.configureLegs(intentId, dto, correlationId);
  }

  async authorizeLeg(
    intentId: string,
    legId: string,
    correlationId?: string,
  ): Promise<LegOperationResult> {
    return this.legExecutionService.authorizeLeg(intentId, legId, correlationId);
  }

  async captureLeg(
    intentId: string,
    legId: string,
    correlationId?: string,
  ): Promise<LegOperationResult> {
    return this.legExecutionService.captureLeg(intentId, legId, correlationId);
  }

  async cancelIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    return this.intentTerminationService.cancelIntent(intentId, correlationId);
  }

  async supersedeIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    return this.intentTerminationService.supersedeIntent(intentId, correlationId);
  }

  async expireIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    return this.intentTerminationService.expireIntent(intentId, correlationId);
  }

  async expireDueIntents(
    limit?: number,
    correlationId?: string,
  ): Promise<ExpireIntentsBatchResult> {
    return this.intentTerminationService.expireDueIntents(limit, correlationId);
  }

  async createRefundRequest(
    intentId: string,
    dto: CreateRefundRequestDto,
    correlationId?: string,
    actorId?: string,
  ): Promise<RefundRequestDetailResult> {
    return this.refundOrchestrationService.createRefundRequest(
      intentId,
      dto,
      correlationId,
      actorId,
    );
  }

  async getRefundRequest(refundId: string): Promise<RefundRequestDetailResult> {
    return this.refundOrchestrationService.getRefundRequest(refundId);
  }
}
