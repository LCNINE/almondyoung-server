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

  /**
   * 회원은 마케팅 동의를, 수신자 그룹 행은 수신거부 번호 목록과 "그 번호를 쓰는 회원의 동의"를 발송 직전에 다시 본다.
   * 대량 발송은 며칠에 걸쳐 나가서, 만든 뒤에 사이트에서 동의를 끈 회원이 그룹에 있으면 여기서만 걸린다.
   */
  private async withoutWithdrawnMarketing(rows: Notification[]): Promise<Notification[]> {
    const marketing = rows.filter((row) => row.category === 'MARKETING');
    if (marketing.length === 0) return rows;
    const isGroupRow = (row: Notification) => !!row.metadata?.recipientGroupId;
    const phoneOf = (row: Notification) => toKrE164(row.payload?.phoneNumber ?? '');
    const groupPhones = [...new Set(marketing.filter(isGroupRow).map(phoneOf))];
    // ponytail: 번호마다 한 번씩 부른다. 한 주기 대상이 배치 상한(대량 5건)이라 버틴다. 늘리면 일괄 조회 API 로.
    const groupPhoneUsers = await Promise.all(
      groupPhones.map(async (phone) => [phone, await this.userContactClient.findActiveContactsByPhone(phone)] as const),
    );
    const memberUserIds = marketing.filter((row) => !isGroupRow(row)).map((row) => row.userId);
    const [contacts, optedOut] = await Promise.all([
      this.userContactClient.findContacts([
        ...new Set([...memberUserIds, ...groupPhoneUsers.flatMap(([, users]) => users.map((u) => u.userId))]),
      ]),
      this.repository.findOptedOut(groupPhones),
    ]);
    const nonConsentedPhones = new Set(
      groupPhoneUsers
        .filter(([, users]) => users.some((u) => contacts.get(u.userId)?.marketingConsent === false))
        .map(([phone]) => phone),
    );
    const kept: Notification[] = [];
    for (const row of rows) {
      if (row.category === 'MARKETING') {
        const withdrawn = isGroupRow(row)
          ? optedOut.has(phoneOf(row)) || nonConsentedPhones.has(phoneOf(row))
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
