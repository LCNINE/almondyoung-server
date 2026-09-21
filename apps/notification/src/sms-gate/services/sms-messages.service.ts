import { Injectable } from '@nestjs/common';
import { Notification } from '../../../database/schemas/notification-schema';
import { SendSmsGateMessageDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsGateSendResult, SmsMessageManager } from './sms-message.manager';

@Injectable()
export class SmsMessagesService {
  constructor(
    private readonly messageManager: SmsMessageManager,
    private readonly repository: SmsGateRepository,
  ) {}

  send(dto: SendSmsGateMessageDto, sentBy: string): Promise<SmsGateSendResult> {
    return this.messageManager.send(dto, sentBy);
  }

  capacity(deviceId?: string): Promise<{ remaining: number }> {
    return this.messageManager.capacity(deviceId);
  }

  find(ids: string[]): Promise<Notification[]> {
    return this.repository.findMessages(ids);
  }
}
