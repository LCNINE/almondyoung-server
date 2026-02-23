import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RetryReconcileDto } from './dto/retry-reconcile.dto';
import {
  RetryIntentResponseDto,
  RetryLegResponseDto,
} from './dto/retry-reconcile-response.dto';
import { ReconcileService } from './reconcile.service';
import { ApiWalletCreatedResponse } from '../common/decorators/api-wallet-response.decorator';
import { WalletErrorResponseDto } from '../common/dto/api-envelope.dto';

@ApiTags('Wallet Reconcile Admin')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  description: 'JWT authentication required',
  type: WalletErrorResponseDto,
})
@Controller('v1/admin')
export class ReconcileController {
  constructor(private readonly reconcileService: ReconcileService) {}

  @Post('intents/:intentId/reconcile/retry')
  @ApiOperation({
    summary: 'Retry intent reconcile',
    description: 'Retries reconcile flow for a target intent.',
  })
  @ApiParam({
    name: 'intentId',
    description: 'Payment intent identifier',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Idempotency key for write APIs',
  })
  @ApiHeader({
    name: 'X-Correlation-Id',
    required: false,
    description: 'Correlation identifier for tracing',
  })
  @ApiHeader({
    name: 'X-Actor-Id',
    required: false,
    description: 'Actor identifier for audit',
  })
  @ApiWalletCreatedResponse(RetryIntentResponseDto, {
    description: 'Intent reconcile retry completed',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request payload or missing idempotency key',
    type: WalletErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Intent not found',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Retry not allowed for current intent status',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
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
  @ApiOperation({
    summary: 'Retry leg reconcile',
    description: 'Retries reconcile flow for a target leg.',
  })
  @ApiParam({
    name: 'legId',
    description: 'Payment leg identifier',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Idempotency key for write APIs',
  })
  @ApiHeader({
    name: 'X-Correlation-Id',
    required: false,
    description: 'Correlation identifier for tracing',
  })
  @ApiHeader({
    name: 'X-Actor-Id',
    required: false,
    description: 'Actor identifier for audit',
  })
  @ApiWalletCreatedResponse(RetryLegResponseDto, {
    description: 'Leg reconcile retry completed',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request payload or missing idempotency key',
    type: WalletErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Leg or parent intent not found',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Retry not allowed for current leg status',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
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
