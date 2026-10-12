import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateSmsDeviceDto, UpdateSmsDeviceDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsDevicesService } from '../services/sms-devices.service';
import { RequirePermission } from '@app/authorization';

@ApiTags('sms-gate')
@Controller('sms-gate/devices')
@UseGuards(SmsGateEnabledGuard)
export class SmsDevicesController {
  constructor(private readonly service: SmsDevicesService) {}

  @RequirePermission('messaging.message.read')
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission('messaging.device.write')
  @Post()
  create(@Body() dto: CreateSmsDeviceDto) {
    return this.service.create(dto);
  }

  @RequirePermission('messaging.device.write')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSmsDeviceDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission('messaging.device.write')
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
