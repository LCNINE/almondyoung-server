import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { authenticatedWarehouseActor, WarehouseActor } from '../services/warehouse-operation-contract';

@Controller('inventory')
@UseGuards(ScopeGuard)
export class WarehouseWorkContextController {
  @Get('work-context')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  workContext(@User() user: WarehouseActor) {
    return { actorId: authenticatedWarehouseActor(user), operationContractVersion: 2 as const };
  }

  @Get('diagnostics-access')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  diagnosticsAccess(@User() user: WarehouseActor): void {
    authenticatedWarehouseActor(user);
  }
}
