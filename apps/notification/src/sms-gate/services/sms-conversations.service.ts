import { Injectable } from '@nestjs/common';
import { ListSmsConversationsDto, ReplySmsConversationDto } from '../dto';
import { SmsConversationManager } from './sms-conversation.manager';
import { ConversationDetail, ConversationPage, SmsConversationReader } from './sms-conversation.reader';
import { SmsGateSendResult } from './sms-message.manager';

@Injectable()
export class SmsConversationsService {
  constructor(
    private readonly conversationReader: SmsConversationReader,
    private readonly conversationManager: SmsConversationManager,
  ) {}

  list(dto: ListSmsConversationsDto): Promise<ConversationPage> {
    return this.conversationReader.list(dto);
  }

  detail(phoneNumber: string): Promise<ConversationDetail> {
    return this.conversationReader.detail(phoneNumber);
  }

  delete(phoneNumber: string): Promise<void> {
    return this.conversationManager.delete(phoneNumber);
  }

  reply(dto: ReplySmsConversationDto, sentBy: string): Promise<SmsGateSendResult> {
    return this.conversationManager.reply(dto, sentBy);
  }
}
