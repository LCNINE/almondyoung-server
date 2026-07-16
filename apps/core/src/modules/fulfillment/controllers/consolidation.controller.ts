import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ConsolidationActor, ConsolidationCandidateQueryDto, CreateConsolidationDto } from '../dto/consolidation.dto';
import { ConsolidationService } from '../services/consolidation.service';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

@Controller('shipments')
@UseGuards(ScopeGuard)
export class ConsolidationController {
  constructor(private readonly consolidation: ConsolidationService) {}

  @Get('consolidation-candidates')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  findCandidates(@Query() query: ConsolidationCandidateQueryDto) {
    return this.consolidation.findCandidates(query.warehouseId, query.sourceShipmentId);
  }

  @Post('consolidations')
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE)
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
