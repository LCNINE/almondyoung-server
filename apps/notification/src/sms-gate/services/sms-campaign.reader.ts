import { Injectable } from '@nestjs/common';
import { SmsAudienceSummary, UserContactClient } from '@app/shared';
import { NotificationCampaign } from '../../../database/schemas/notification-schema';
import { PreviewSmsCampaignDto } from '../dto';
import { isSendable } from '../utils/device-picker';
import { bulkIntervalMs, BulkDevice, estimateBulkSchedule } from '../utils/bulk-schedule';
import { BULK_WINDOW_END_HOUR, BULK_WINDOW_START_HOUR } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsDeviceReader, SmsDeviceStatus } from './sms-device.reader';

const CAMPAIGN_LIST_LIMIT = 50;

export type SmsCampaignState = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export interface SmsCampaignListItem {
  campaignId: string;
  name: string;
  category: NotificationCampaign['category'];
  content: string;
  sendAt: Date | null;
  state: SmsCampaignState;
  createdBy: string;
  createdAt: Date;
  counts: { total: number; pending: number; sent: number; failed: number; cancelled: number };
  estimatedCompleteDate: string | null;
}

export interface SmsCampaignPreview {
  audience: SmsAudienceSummary;
  recipients: number;
  excluded: number;
  ahead: number;
  window: { start: string; end: string };
  devices: { name: string; dailyLimit: number; intervalSeconds: number }[];
  estimatedStartDate: string | null;
  estimatedCompleteDate: string | null;
  /** 폰이 꺼지거나 단건이 끼어들면 밀린다. 같은 번호의 중복 계정은 발송 때 한 통으로 합쳐진다. */
  estimated: true;
}

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

@Injectable()
export class SmsCampaignReader {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly deviceReader: SmsDeviceReader,
    private readonly userContactClient: UserContactClient,
  ) {}

  audience(): Promise<SmsAudienceSummary> {
    return this.userContactClient.summarizeSmsAudience();
  }

  async preview(dto: PreviewSmsCampaignDto): Promise<SmsCampaignPreview> {
    const now = new Date();
    const [audience, ahead, devices] = await Promise.all([
      this.userContactClient.summarizeSmsAudience(),
      this.repository.countPending(),
      this.activeDevices(now),
    ]);
    const recipients = dto.category === 'MARKETING' ? audience.consented : audience.withPhone;
    const estimate = estimateBulkSchedule(devices, now, dto.sendAt ? new Date(dto.sendAt) : now, ahead, recipients);
    return {
      audience,
      recipients,
      excluded: audience.active - recipients,
      ahead,
      window: { start: hour(BULK_WINDOW_START_HOUR), end: hour(BULK_WINDOW_END_HOUR) },
      devices: devices.map((d) => ({
        name: d.name,
        dailyLimit: d.dailyLimit,
        intervalSeconds: Math.round(bulkIntervalMs(d.dailyLimit) / 1000),
      })),
      estimatedStartDate: estimate.startDate,
      estimatedCompleteDate: estimate.completeDate,
      estimated: true,
    };
  }

  async list(): Promise<SmsCampaignListItem[]> {
    const now = new Date();
    const campaigns = await this.repository.listCampaigns(CAMPAIGN_LIST_LIMIT);
    const [counts, devices, pendingSingles] = await Promise.all([
      this.repository.countByCampaign(campaigns.map((c) => c.campaignId)),
      this.activeDevices(now),
      this.repository.countPending(true),
    ]);

    const items = campaigns.map((campaign) => {
      const byStatus = (status: string) =>
        counts.find((c) => c.campaignId === campaign.campaignId && c.status === status)?.count ?? 0;
      const pending = byStatus('PENDING') + byStatus('PROCESSING');
      const total = counts.filter((c) => c.campaignId === campaign.campaignId).reduce((sum, c) => sum + c.count, 0);
      return {
        campaignId: campaign.campaignId,
        name: campaign.name,
        category: campaign.category,
        content: campaign.content?.SMS?.body ?? '',
        sendAt: campaign.sendAt,
        state: this.stateOf(campaign, pending, now),
        createdBy: campaign.createdBy,
        createdAt: campaign.createdAt,
        counts: { total, pending, sent: byStatus('SENT'), failed: byStatus('FAILED'), cancelled: byStatus('CANCELLED') },
        estimatedCompleteDate: null as string | null,
      };
    });

    // 먼저 만든 캠페인부터 소진되므로, 오래된 것부터 앞 대기분을 쌓아 가며 예상한다.
    let ahead = pendingSingles;
    for (const item of [...items].reverse()) {
      if (item.state !== 'PROCESSING' && item.state !== 'SCHEDULED') continue;
      const estimate = estimateBulkSchedule(devices, now, item.sendAt ?? now, ahead, item.counts.pending);
      item.estimatedCompleteDate = estimate.completeDate;
      ahead += item.counts.pending;
    }
    return items;
  }

  private stateOf(campaign: NotificationCampaign, pending: number, now: Date): SmsCampaignState {
    if (campaign.status === 'CANCELLED') return 'CANCELLED';
    if (pending === 0) return 'COMPLETED';
    if (campaign.sendAt && campaign.sendAt > now) return 'SCHEDULED';
    return 'PROCESSING';
  }

  private async activeDevices(now: Date): Promise<(SmsDeviceStatus & BulkDevice)[]> {
    const devices = await this.deviceReader.loadStatuses(now);
    return devices.filter((d) => isSendable({ ...d, sentToday: 0 }, now));
  }
}
