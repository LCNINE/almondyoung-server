import { Body, Controller, Get, Headers, Param, Post, Put } from '@nestjs/common';
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
import { CreateIntentDto } from './dto/create-intent.dto';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import { IntentsService } from './intents.service';
import {
  IntentTerminationResultResponseDto,
  LegOperationResultResponseDto,
  PaymentIntentResponseDto,
  PaymentLegResponseDto,
  RefundRequestDetailResponseDto,
} from './dto/intents-response.dto';
import {
  ApiWalletCreatedResponse,
  ApiWalletOkArrayResponse,
  ApiWalletOkResponse,
} from '../common/decorators/api-wallet-response.decorator';
import { WalletErrorResponseDto } from '../common/dto/api-envelope.dto';

@ApiTags('Wallet Intents')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  description: 'JWT authentication required',
  type: WalletErrorResponseDto,
})
@Controller('v1/intents')
export class IntentsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create intent',
    description: 'Creates a payment intent from the signed checkout snapshot.',
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
  @ApiWalletCreatedResponse(PaymentIntentResponseDto, {
    description: 'Payment intent created',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request payload or missing idempotency key',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Blocking intent already exists for reference or idempotency conflict',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async createIntent(
    @Body() dto: CreateIntentDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.createIntent(dto, correlationId);
    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':intentId')
  @ApiOperation({
    summary: 'Get intent',
    description: 'Returns a payment intent by identifier.',
  })
  @ApiParam({
    name: 'intentId',
    description: 'Payment intent identifier',
  })
  @ApiWalletOkResponse(PaymentIntentResponseDto, {
    description: 'Payment intent fetched',
  })
  @ApiNotFoundResponse({
    description: 'Intent not found',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async getIntent(@Param('intentId') intentId: string) {
    const data = await this.intentsService.getIntent(intentId);
    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Put(':intentId/legs')
  @ApiOperation({
    summary: 'Configure legs',
    description: 'Configures execution legs for the given intent.',
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
  @ApiWalletOkArrayResponse(PaymentLegResponseDto, {
    description: 'Legs configured',
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
    description: 'Leg configuration is not allowed for current intent state',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async configureLegs(
    @Param('intentId') intentId: string,
    @Body() dto: ConfigureLegsDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.configureLegs(
      intentId,
      dto,
      correlationId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/legs/:legId/authorize')
  @ApiOperation({
    summary: 'Authorize leg',
    description: 'Runs authorize operation for the selected leg.',
  })
  @ApiParam({
    name: 'intentId',
    description: 'Payment intent identifier',
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
  @ApiWalletCreatedResponse(LegOperationResultResponseDto, {
    description: 'Leg authorized',
  })
  @ApiBadRequestResponse({
    description: 'Missing idempotency key or invalid request state',
    type: WalletErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Intent or leg not found',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Authorize operation conflict',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async authorizeLeg(
    @Param('intentId') intentId: string,
    @Param('legId') legId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.authorizeLeg(
      intentId,
      legId,
      correlationId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/legs/:legId/capture')
  @ApiOperation({
    summary: 'Capture leg',
    description: 'Runs capture operation for the selected leg.',
  })
  @ApiParam({
    name: 'intentId',
    description: 'Payment intent identifier',
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
  @ApiWalletCreatedResponse(LegOperationResultResponseDto, {
    description: 'Leg captured',
  })
  @ApiBadRequestResponse({
    description: 'Missing idempotency key or invalid request state',
    type: WalletErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Intent or leg not found',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Capture operation conflict',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async captureLeg(
    @Param('intentId') intentId: string,
    @Param('legId') legId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.captureLeg(
      intentId,
      legId,
      correlationId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/cancel')
  @ApiOperation({
    summary: 'Cancel intent',
    description: 'Cancels a payment intent.',
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
  @ApiWalletCreatedResponse(IntentTerminationResultResponseDto, {
    description: 'Intent cancelled',
  })
  @ApiBadRequestResponse({
    description: 'Missing idempotency key or invalid request state',
    type: WalletErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Intent not found',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Cancel operation conflict',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async cancelIntent(
    @Param('intentId') intentId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.cancelIntent(intentId, correlationId);

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/supersede')
  @ApiOperation({
    summary: 'Supersede intent',
    description: 'Supersedes a payment intent with a terminal superseded state.',
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
  @ApiWalletCreatedResponse(IntentTerminationResultResponseDto, {
    description: 'Intent superseded',
  })
  @ApiBadRequestResponse({
    description: 'Missing idempotency key or invalid request state',
    type: WalletErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Intent not found',
    type: WalletErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Supersede operation conflict',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async supersedeIntent(
    @Param('intentId') intentId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.supersedeIntent(intentId, correlationId);

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/refund-requests')
  @ApiOperation({
    summary: 'Create refund request',
    description: 'Creates a refund request with allocation details for the given intent.',
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
  @ApiWalletCreatedResponse(RefundRequestDetailResponseDto, {
    description: 'Refund request created',
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
    description: 'Refund request conflict',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
  async createRefundRequest(
    @Param('intentId') intentId: string,
    @Body() dto: CreateRefundRequestDto,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const data = await this.intentsService.createRefundRequest(
      intentId,
      dto,
      correlationId,
      actorId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
