import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { User, RequirePermission, PiiResponse, OPEN_WITH_RECIPIENT } from '@app/authorization';
import {
  ConsolidationActor,
  ConsolidationCandidateQueryDto,
  ConsolidationOptionsQueryDto,
  ConsolidationOptionsResponseDto,
  ConsolidationProgressResponseDto,
  CreateConsolidationDto,
} from '../dto/consolidation.dto';
import { ConsolidationOptionsService } from '../services/consolidation-options.service';
import { ConsolidationProgressService } from '../services/consolidation-progress.service';
import { ConsolidationService } from '../services/consolidation.service';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

@Controller('shipments')
export class ConsolidationController {
  constructor(
    private readonly consolidation: ConsolidationService,
    private readonly options: ConsolidationOptionsService,
    private readonly progress: ConsolidationProgressService,
  ) {}

  @PiiResponse({
    fields: {
      '[].recipientSnapshot.recipientName': 'name',
      '[].recipientSnapshot.phone': 'phone',
      '[].recipientSnapshot.postalCode': 'postal',
      '[].recipientSnapshot.roadAddress': 'address',
      '[].recipientSnapshot.detailAddress': 'text',
      '[].recipientSnapshot.deliveryNote': 'text',
      '[].recipientSnapshot.personalCustomsCode': 'secret',
    },
    subjects: [{ path: '[].shipmentId', type: 'shipment' }],
    rawWithByField: {
      '[].recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      '[].recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      '[].recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      '[].recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      '[].recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      '[].recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      '[].recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.shipment.read')
  @Get('consolidation-candidates')
  findCandidates(@Query() query: ConsolidationCandidateQueryDto) {
    return this.consolidation.findCandidates(query.warehouseId, query.sourceShipmentId);
  }

  @PiiResponse({
    fields: {
      'source.recipientSnapshot.recipientName': 'name',
      'source.recipientSnapshot.phone': 'phone',
      'source.recipientSnapshot.postalCode': 'postal',
      'source.recipientSnapshot.roadAddress': 'address',
      'source.recipientSnapshot.detailAddress': 'text',
      'source.recipientSnapshot.deliveryNote': 'text',
      'source.recipientSnapshot.personalCustomsCode': 'secret',
      'options[].recipientSnapshot.recipientName': 'name',
      'options[].recipientSnapshot.phone': 'phone',
      'options[].recipientSnapshot.postalCode': 'postal',
      'options[].recipientSnapshot.roadAddress': 'address',
      'options[].recipientSnapshot.detailAddress': 'text',
      'options[].recipientSnapshot.deliveryNote': 'text',
      'options[].recipientSnapshot.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: 'source.shipmentId', type: 'shipment' },
      { path: 'options[].shipmentId', type: 'shipment' },
    ],
    rawWithByField: {
      'source.recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'source.recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'source.recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'source.recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'source.recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'source.recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'source.recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'options[].recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.shipment.read')
  @Get('consolidation-options')
  findOptions(@Query() query: ConsolidationOptionsQueryDto): Promise<ConsolidationOptionsResponseDto> {
    return this.options.findOptions(query.shipmentId);
  }

  // 수령인을 담지 않으므로 PII 선언이 없다
  @RequirePermission('fulfillment.shipment.read')
  @Get(':id/consolidation-progress')
  findProgress(@Param('id', ParseUUIDPipe) id: string): Promise<ConsolidationProgressResponseDto | null> {
    return this.progress.findForShipment(id);
  }

  @RequirePermission('fulfillment.shipment.consolidate')
  @Post('consolidations')
  consolidate(
    @Body() dto: CreateConsolidationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.consolidation.consolidate(dto, idempotencyKey ?? '', this.actor(user));
  }

  private actor(user: AuthenticatedUser | undefined): ConsolidationActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
