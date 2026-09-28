import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, UserContactClient } from '@app/shared';
import { NewNotification, Notification } from '../../../database/schemas/notification-schema';
import { NotificationProvider } from '../../provider/interfaces/notification-provider.interface';
import { ProviderManagerService } from '../../provider/services/provider-manager.service';
import { Channel } from '../../shared/enums';
import { getContactForChannel } from '../../shared/utils/contact.utils';
import { SendSmsGateMessageDto } from '../dto';
import { composeSmsBody, fillName } from '../utils/sms-body';
import { remainingCapacity } from '../utils/device-picker';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsDeviceReader } from './sms-device.reader';

export interface SmsGateSendResult {
  queued: { notificationId: string; userId: string }[];
  skipped: { userId: string; reason: string }[];
}

@Injectable()
export class SmsMessageManager {
  private readonly logger = new Logger(SmsMessageManager.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly userContactClient: UserContactClient,
    private readonly deviceReader: SmsDeviceReader,
    private readonly providerManager: ProviderManagerService,
  ) {}

  /** 지금 폰으로 바로 나갈 수 있는 단건 수. 먼저 들어온 단건 대기분을 뺀다. */
  async capacity(deviceId?: string): Promise<{ remaining: number }> {
    const [devices, pendingSingles] = await Promise.all([
      this.deviceReader.loadStatuses(new Date()),
      this.repository.countPending(true),
    ]);
    return { remaining: Math.max(0, remainingCapacity(devices, new Date(), deviceId) - pendingSingles) };
  }

  async send(dto: SendSmsGateMessageDto, sentBy: string): Promise<SmsGateSendResult> {
    const viaNhnOnly = dto.route === 'NHN';
    if (viaNhnOnly && dto.category === 'MARKETING') {
      throw new BadRequestError('광고 문자는 수신거부 답장을 받아야 해서 발송폰으로만 보낼 수 있습니다');
    }
    if (dto.deviceId && !viaNhnOnly) {
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
      if (dto.category === 'MARKETING' && !contact.marketingConsent) {
        skipped.push({ userId, reason: '마케팅 수신 동의가 없습니다' });
        return [];
      }
      return [
        {
          userId,
          category: dto.category,
          priority: 'HIGH' as const,
          channel: Channel.SMS,
          language: 'ko' as const,
          providerId: SMS_GATE_PROVIDER_ID,
          status: 'PENDING' as const,
          payload: { phoneNumber: contact.phoneNumber, username: contact.username },
          renderedContent: { body: composeSmsBody(dto.category, fillName(dto.content, contact.username)) },
          metadata: { requestedDeviceId: dto.deviceId ?? null, sentBy },
        },
      ];
    });

    // 광고는 수신거부가 폰 답장뿐이라 대표번호로 우회하지 않는다.
    const phoneCount = viaNhnOnly
      ? 0
      : dto.nhnFallback && dto.category === 'INFORMATIONAL'
        ? (await this.capacity(dto.deviceId)).remaining
        : rows.length;
    const inserted: Notification[] = await this.repository.enqueue(rows.slice(0, phoneCount));
    const viaNhn = await this.sendViaNhn(rows.slice(phoneCount), skipped);
    return {
      queued: [...inserted, ...viaNhn].map((row) => ({ notificationId: row.notificationId, userId: row.userId })),
      skipped,
    };
  }

  private async sendViaNhn(rows: NewNotification[], skipped: SmsGateSendResult['skipped']): Promise<Notification[]> {
    if (rows.length === 0) return [];
    const provider = await this.providerManager.getAvailableProviderForChannel(Channel.SMS);
    if (!provider) {
      skipped.push(...rows.map((row) => ({ userId: row.userId, reason: '대표번호(NHN) 발송 프로바이더가 없습니다' })));
      return [];
    }
    const inserted = await this.repository.enqueue(
      rows.map((row) => ({
        ...row,
        providerId: provider.getProviderId(),
        status: 'PROCESSING' as const,
        metadata: { ...row.metadata, route: 'nhn' },
      })),
    );
    for (const row of inserted) await this.deliverViaNhn(provider, row);
    return inserted;
  }

  private async deliverViaNhn(provider: NotificationProvider, row: Notification): Promise<void> {
    const contact = getContactForChannel({ userId: row.userId, phoneNumber: row.payload?.phoneNumber }, Channel.SMS);
    if (!contact) {
      await this.repository.markFailed(row, null, '수신 번호가 없습니다 (운영 외 환경은 NOTIFICATION_DEV_PHONE 필요)');
      return;
    }
    try {
      const result = await provider.send({
        to: contact,
        content: row.renderedContent?.body ?? '',
        metadata: { notificationId: row.notificationId, category: row.category },
      });
      if (result.success) await this.repository.markSent(row, null, result.messageId ?? '');
      else await this.repository.markFailed(row, null, result.error ?? '대표번호 발송 실패');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`대표번호 발송 실패 notificationId=${row.notificationId}: ${message}`);
      await this.repository.markFailed(row, null, message);
    }
  }
}
