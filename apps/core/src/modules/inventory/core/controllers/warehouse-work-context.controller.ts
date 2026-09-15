import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../../platform/auth/fulfillment-scopes';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { authenticatedWarehouseActor, WarehouseActor } from '../services/warehouse-operation-contract';

@Controller('inventory')
@UseGuards(ScopeGuard)
export class WarehouseWorkContextController {
  constructor(private readonly scopes: ScopeGuard) {}

  @Get('work-context')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  async workContext(@User() user: WarehouseActor & { roles?: string[] }) {
    const actorId = authenticatedWarehouseActor(user);
    const granted = await this.scopes.getGrantedScopes(user, [FULFILLMENT_SCOPE.DISPATCH_FORCE]);
    return {
      actorId,
      operationContractVersion: 2 as const,
      permissions: { forceDispatch: granted.includes(FULFILLMENT_SCOPE.DISPATCH_FORCE) },
      capabilities: {
        stocktakingAddCountItem: true as const,
        locationOutbound: true as const,
        inboundWorkflowConsistency: true as const,
      },
    };
  }

  @Get('diagnostics-access')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  diagnosticsAccess(@User() user: WarehouseActor): void {
    authenticatedWarehouseActor(user);
  }
}
