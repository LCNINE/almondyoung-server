import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { User, RequirePermission, PiiResponse, OPEN_WITH_RECIPIENT } from '@app/authorization';
import { ConsolidationActor, ConsolidationCandidateQueryDto, CreateConsolidationDto } from '../dto/consolidation.dto';
import { ConsolidationService } from '../services/consolidation.service';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

@Controller('shipments')
export class ConsolidationController {
  constructor(private readonly consolidation: ConsolidationService) {}

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
    subjects: [
      { path: '[].shipmentId', type: 'shipment' },
    ],
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
