import { Injectable } from '@nestjs/common';
import { BadRequestError, UserContactClient } from '@app/shared';
import { Notification } from '../../database/schemas/notification-schema';
import { Channel } from '../shared/enums';
import { SendSmsGateMessageDto } from './dto/sms-gate.dto';
import { SMS_GATE_PROVIDER_ID } from './sms-gate.constants';
import { SmsGateRepository } from './sms-gate.repository';

export interface SmsGateSendResult {
  queued: { notificationId: string; userId: string }[];
  skipped: { userId: string; reason: string }[];
}

@Injectable()
export class SmsMessageManager {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly userContactClient: UserContactClient,
  ) {}

  async send(dto: SendSmsGateMessageDto, sentBy: string): Promise<SmsGateSendResult> {
    if (dto.deviceId) {
      const device = await this.repository.findDeviceByDeviceId(dto.deviceId);
      if (!device?.enabled) throw new BadRequestError('선택한 발송폰이 없거나 비활성 상태입니다');
    }

    const userIds = [...new Set(dto.userIds)];
    const contacts = await this.userContactClient.findContacts(userIds);
    const skipped: SmsGateSendResult['skipped'] = [];
    const rows = userIds.flatMap((userId) => {
      const contact = contacts.get(userId);
      if (!contact) {
        skipped.push({ userId, reason: '회원을 찾을 수 없습니다' });
        return [];
      }
      if (!contact.phoneNumber) {
        skipped.push({ userId, reason: '등록된 휴대폰 번호가 없습니다' });
        return [];
      }
      return [
        {
          userId,
          category: 'INFORMATIONAL' as const,
          priority: 'HIGH' as const,
          channel: Channel.SMS,
          language: 'ko' as const,
          providerId: SMS_GATE_PROVIDER_ID,
          status: 'PENDING' as const,
          payload: { phoneNumber: contact.phoneNumber, username: contact.username },
          renderedContent: { body: dto.content },
          metadata: { requestedDeviceId: dto.deviceId ?? null, sentBy },
        },
      ];
    });

    const inserted: Notification[] = await this.repository.enqueue(rows);
    return {
      queued: inserted.map((row) => ({ notificationId: row.notificationId, userId: row.userId })),
      skipped,
    };
  }
}
