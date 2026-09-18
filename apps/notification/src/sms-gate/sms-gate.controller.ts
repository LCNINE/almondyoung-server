import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/decorators/user.decorator';
import { CreateSmsDeviceDto, SendSmsGateMessageDto, UpdateSmsDeviceDto } from './dto/sms-gate.dto';
import { SmsGateEnabledGuard } from './sms-gate-enabled.guard';
import { SmsGateService } from './sms-gate.service';

@ApiTags('sms-gate')
@Controller('sms-gate')
@UseGuards(SmsGateEnabledGuard)
export class SmsGateController {
  constructor(private readonly service: SmsGateService) {}

  @Get('devices')
  listDevices() {
    return this.service.listDevices();
  }

  @Post('devices')
  createDevice(@Body() dto: CreateSmsDeviceDto) {
    return this.service.createDevice(dto);
  }

  @Patch('devices/:id')
  updateDevice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSmsDeviceDto) {
    return this.service.updateDevice(id, dto);
  }

  @Delete('devices/:id')
  deleteDevice(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteDevice(id);
  }

  @Post('messages')
  send(@Body() dto: SendSmsGateMessageDto, @CurrentUser() user: { userId: string }) {
    return this.service.send(dto, user.userId);
  }

  @Get('messages')
  findMessages(@Query('ids') ids = '') {
    return this.service.findMessages(ids.split(',').filter(Boolean));
  }
}
