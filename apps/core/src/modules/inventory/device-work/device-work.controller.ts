import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequireAnyPermission, RequirePermission, User } from '@app/authorization';
import { authenticatedWarehouseActor, WarehouseActor } from '../core/services/warehouse-operation-contract';
import { DeviceWorkService } from './device-work.service';
import {
  DeviceWorkListDto,
  ReportUnresolvedOperationsDto,
  ReportUnresolvedOperationsResponseDto,
  ResolveDeviceWorkDto,
  ResolveDeviceWorkResponseDto,
} from './dto/device-work.dto';

@ApiTags('device-work')
@Controller('inventory')
export class DeviceWorkController {
  constructor(private readonly service: DeviceWorkService) {}

  // 물류앱에 들어온 사람이면 자기 기기에 남은 것을 올린다(입장 확인과 같은 권한)
  @RequireAnyPermission('inventory.stock.read', 'fulfillment.shipment.read')
  @Put('devices/:deviceId/unresolved-operations')
  @HttpCode(200)
  @ApiOkResponse({ type: ReportUnresolvedOperationsResponseDto })
  report(
    @User() user: WarehouseActor,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Body() dto: ReportUnresolvedOperationsDto,
  ) {
    return this.service.report(authenticatedWarehouseActor(user), deviceId, dto);
  }

  @RequirePermission('inventory.device_work.read')
  @Get('device-work')
  @ApiOkResponse({ type: DeviceWorkListDto })
  async list(): Promise<DeviceWorkListDto> {
    return { items: await this.service.listOpen() };
  }

  @RequirePermission('inventory.device_work.resolve')
  @Post('device-work/:operationKey/resolve')
  @HttpCode(200)
  @ApiOkResponse({ type: ResolveDeviceWorkResponseDto })
  resolve(
    @User() user: WarehouseActor,
    @Param('operationKey') operationKey: string,
    @Body() dto: ResolveDeviceWorkDto,
  ) {
    return this.service.resolve(authenticatedWarehouseActor(user), operationKey, dto.action);
  }
}
