import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '../../database/schemas/notification-schema';
import { Channel } from '../shared/enums';
import { getContactForChannel } from '../shared/utils/contact.utils';
import { pickDevice } from './device-picker';
import { SmsDeviceReader } from './sms-device.reader';
import { SMS_GATE_DISPATCH_BATCH } from './sms-gate.constants';
import { SmsGateClient } from './sms-gate.client';
import { SmsGateRepository } from './sms-gate.repository';

@Injectable()
export class SmsDispatchManager {
  private readonly logger = new Logger(SmsDispatchManager.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly deviceReader: SmsDeviceReader,
    private readonly client: SmsGateClient,
  ) {}

  async dispatchDue(now: Date): Promise<void> {
    await this.repository.withDispatchLock(async () => {
      const due = await this.repository.findDue(now, SMS_GATE_DISPATCH_BATCH);
      if (due.length === 0) return;

      const devices = await this.deviceReader.loadStatuses(now);
      for (const row of due) {
        const device = pickDevice(devices, now, row.metadata?.requestedDeviceId);
        if (!device) continue;
        if (!(await this.repository.claim(row))) continue;
        await this.deliver(row, device.deviceId);
        device.sentToday += 1;
      }
    });
  }

  private async deliver(row: Notification, deviceId: string): Promise<void> {
    const contact = getContactForChannel(
      { userId: row.userId, phoneNumber: row.payload?.phoneNumber },
      Channel.SMS,
    );
    if (!contact) {
      await this.repository.markFailed(row, null, '수신 번호가 없습니다 (운영 외 환경은 NOTIFICATION_DEV_PHONE 필요)');
      return;
    }
    try {
      const { id } = await this.client.send(contact, row.renderedContent?.body ?? '', deviceId);
      await this.repository.markSent(row, deviceId, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMS Gate 발송 실패 notificationId=${row.notificationId}: ${message}`);
      await this.repository.markFailed(row, deviceId, message);
    }
  }
}
