import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { SendSmsGateMessageDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsMessagesService } from '../services/sms-messages.service';

@ApiTags('sms-gate')
@Controller('sms-gate/messages')
@UseGuards(SmsGateEnabledGuard)
export class SmsMessagesController {
  constructor(private readonly service: SmsMessagesService) {}

  @Post()
  send(@Body() dto: SendSmsGateMessageDto, @CurrentUser() user: { userId: string }) {
    return this.service.send(dto, user.userId);
  }

  @Get()
  find(@Query('ids') ids = '') {
    return this.service.find(ids.split(',').filter(Boolean));
  }
}
