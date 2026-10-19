import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { ListSmsConversationsDto, ReplySmsConversationDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsConversationsService } from '../services/sms-conversations.service';
import { RequirePermission, PiiResponse } from '@app/authorization';

@ApiTags('sms-gate')
@Controller('sms-gate/conversations')
@UseGuards(SmsGateEnabledGuard)
export class SmsConversationsController {
  constructor(private readonly service: SmsConversationsService) {}

  @PiiResponse({
    fields: { 'items[].phoneNumber': 'phone', 'items[].name': 'name', 'items[].lastMessage.text': 'text' },
    // 비회원 번호와의 대화는 회원 id 가 없다 — 번호를 해시로 남긴다.
    subjects: [
      { path: 'items[].userId', type: 'user' },
      { path: 'items[].phoneNumber', type: 'sms_conversation', hash: true },
    ],
  })
  @RequirePermission('messaging.message.read')
  @Get()
  list(@Query() dto: ListSmsConversationsDto) {
    return this.service.list(dto);
  }

  @PiiResponse({
    fields: { phoneNumber: 'phone', name: 'name', 'messages[].text': 'text' },
    subjects: [
      { path: 'userId', type: 'user' },
      { path: 'phoneNumber', type: 'sms_conversation', hash: true },
    ],
    reveal: true,
  })
  @RequirePermission('messaging.message.read')
  @Get('messages')
  detail(@Query('phone') phone?: string) {
    if (!phone) throw new BadRequestException('phone is required');
    return this.service.detail(phone);
  }

  @RequirePermission('messaging.message.send')
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Query('phone') phone?: string) {
    if (!phone) throw new BadRequestException('phone is required');
    return this.service.delete(phone);
  }

  @RequirePermission('messaging.message.send')
  @Post('reply')
  reply(@Body() dto: ReplySmsConversationDto, @CurrentUser() user: { userId: string }) {
    return this.service.reply(dto, user.userId);
  }
}
