import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { ListSmsConversationsDto, ReplySmsConversationDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsConversationsService } from '../services/sms-conversations.service';

@ApiTags('sms-gate')
@Controller('sms-gate/conversations')
@UseGuards(SmsGateEnabledGuard)
export class SmsConversationsController {
  constructor(private readonly service: SmsConversationsService) {}

  @Get()
  list(@Query() dto: ListSmsConversationsDto) {
    return this.service.list(dto);
  }

  @Get('messages')
  detail(@Query('phone') phone?: string) {
    if (!phone) throw new BadRequestException('phone is required');
    return this.service.detail(phone);
  }

  @Post('reply')
  reply(@Body() dto: ReplySmsConversationDto, @CurrentUser() user: { userId: string }) {
    return this.service.reply(dto, user.userId);
  }
}
