import { Injectable, Logger } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { Notification } from '../../../database/schemas/notification-schema';
import { Channel } from '../../shared/enums';
import { getContactForChannel } from '../../shared/utils/contact.utils';
import { pickDevice } from '../utils/device-picker';
import { isMarketingQuietHours } from '../utils/sms-body';
import { isBulkIntervalPassed, isBulkWindow } from '../utils/bulk-schedule';
import { SmsDeviceReader } from './sms-device.reader';
import { SMS_GATE_BULK_DISPATCH_BATCH, SMS_GATE_DISPATCH_BATCH } from '../constants/sms-gate.constants';
import { SmsGateClient, toKrE164 } from '../clients/sms-gate.client';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

@Injectable()
export class SmsDispatchManager {
  private readonly logger = new Logger(SmsDispatchManager.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly deviceReader: SmsDeviceReader,
    private readonly client: SmsGateClient,
    private readonly userContactClient: UserContactClient,
  ) {}

  async dispatchDue(now: Date): Promise<void> {
    await this.repository.withDispatchLock(async () => {
      const includeMarketing = !isMarketingQuietHours(now);
      const [singles, bulk] = await Promise.all([
        this.repository.findDue(now, SMS_GATE_DISPATCH_BATCH, includeMarketing, false),
        isBulkWindow(now)
          ? this.repository.findDue(now, SMS_GATE_BULK_DISPATCH_BATCH, includeMarketing, true)
          : Promise.resolve([]),
      ]);
      const due = await this.withoutWithdrawnMarketing([...singles, ...bulk]);
      if (due.length === 0) return;

      const devices = await this.deviceReader.loadStatuses(now);
      for (const row of due) {
        // 발송마다 시간이 걸리므로 시간대는 보내기 직전 시각으로 다시 본다.
        const at = new Date();
        if (row.campaignId && !isBulkWindow(at)) continue;
        if (row.category === 'MARKETING' && isMarketingQuietHours(at)) continue;
        const device = row.campaignId
          ? pickDevice(
              devices.filter((d) => isBulkIntervalPassed(d, at)),
              at,
            )
          : pickDevice(devices, at, row.metadata?.requestedDeviceId);
        if (!device) continue;
        if (!(await this.repository.claim(row))) continue;
        await this.deliver(row, device.deviceId);
        device.sentToday += 1;
        device.lastSentAt = new Date();
      }
    });
  }

  /** 회원은 마케팅 동의를, 수신자 그룹(비회원) 행은 수신거부 번호 목록을 발송 직전에 다시 본다. */
  private async withoutWithdrawnMarketing(rows: Notification[]): Promise<Notification[]> {
    const marketing = rows.filter((row) => row.category === 'MARKETING');
    if (marketing.length === 0) return rows;
    const isGroupRow = (row: Notification) => !!row.metadata?.recipientGroupId;
    const [contacts, optedOut] = await Promise.all([
      this.userContactClient.findContacts([...new Set(marketing.filter((row) => !isGroupRow(row)).map((row) => row.userId))]),
      this.repository.findOptedOut(marketing.filter(isGroupRow).map((row) => toKrE164(row.payload?.phoneNumber ?? ''))),
    ]);
    const kept: Notification[] = [];
    for (const row of rows) {
      if (row.category === 'MARKETING') {
        const withdrawn = isGroupRow(row)
          ? optedOut.has(toKrE164(row.payload?.phoneNumber ?? ''))
          : !contacts.get(row.userId)?.marketingConsent;
        if (withdrawn) {
          await this.repository.markCancelled(row, '발송 전 수신거부 또는 마케팅 수신 동의 철회가 확인되었습니다');
          continue;
        }
      }
      kept.push(row);
    }
    return kept;
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
