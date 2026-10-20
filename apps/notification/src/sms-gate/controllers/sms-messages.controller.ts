import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { SendSmsGateMessageDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsMessagesService } from '../services/sms-messages.service';
import { RequirePermission, PiiResponse } from '@app/authorization';

@ApiTags('sms-gate')
@Controller('sms-gate/messages')
@UseGuards(SmsGateEnabledGuard)
export class SmsMessagesController {
  constructor(private readonly service: SmsMessagesService) {}

  @RequirePermission('messaging.message.send')
  @Post()
  send(@Body() dto: SendSmsGateMessageDto, @CurrentUser() user: { userId: string }) {
    return this.service.send(dto, user.userId);
  }

  @RequirePermission('messaging.message.read')
  @Get('capacity')
  capacity(@Query('deviceId') deviceId?: string) {
    return this.service.capacity(deviceId);
  }

  @PiiResponse({
    fields: { '[].payload': 'redact', '[].renderedContent': 'redact', '[].metadata': 'redact' },
    subjects: [
      { path: '[].notificationId', type: 'notification' },
      { path: '[].userId', type: 'user' },
    ],
  })
  @RequirePermission('messaging.message.read')
  @Get()
  find(@Query('ids') ids = '') {
    return this.service.find(ids.split(',').filter(Boolean));
  }
}
