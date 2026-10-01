import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, NotFoundError, SmsAudienceSummary, UserContact, UserContactClient } from '@app/shared';
import { NotificationCampaign } from '../../../database/schemas/notification-schema';
import { PreviewSmsCampaignDto } from '../dto';
import { MergedAudience, mergeCampaignAudience } from '../utils/campaign-audience';
import { toKrE164 } from '../clients/sms-gate.client';
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
  createdByName: string | null;
  createdAt: Date;
  counts: { total: number; pending: number; sent: number; failed: number; cancelled: number };
  clicked: number;
  estimatedCompleteDate: string | null;
}

export interface SmsCampaignClick {
  notificationId: string;
  userId: string;
  name: string | null;
  phoneNumber: string | null;
  url: string;
  clickCount: number;
  firstClickedAt: Date | null;
  lastClickedAt: Date | null;
}

export interface SmsCampaignPreview {
  recipients: number;
  excluded: number;
  duplicates: number;
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
  private readonly logger = new Logger(SmsCampaignReader.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly deviceReader: SmsDeviceReader,
    private readonly userContactClient: UserContactClient,
  ) {}

  audience(): Promise<SmsAudienceSummary> {
    return this.userContactClient.summarizeSmsAudience();
  }

  /**
   * 발송 명단을 확정한다. 미리보기와 생성이 같은 함수를 써서 확인창 숫자와 실제 발송 수가 갈리지 않는다.
   * 광고로 그룹에 보낼 때는 회원 명단도 불러와 동의 안 한 회원의 번호를 뺀다.
   */
  async resolveAudience(dto: PreviewSmsCampaignDto): Promise<MergedAudience> {
    const groupIds = [...new Set(dto.groupIds ?? [])];
    const includeMembers = dto.includeMembers ?? false;
    if (!includeMembers && groupIds.length === 0) throw new BadRequestError('받는 사람을 하나 이상 고르세요');
    const found = await this.repository.findRecipientGroupsByIds(groupIds);
    const missing = groupIds.filter((id) => !found.some((g) => g.id === id));
    if (missing.length > 0) throw new NotFoundError(`수신자 그룹을 찾을 수 없습니다: ${missing.join(', ')}`);

    const marketing = dto.category === 'MARKETING';
    const [members, groupRows] = await Promise.all([
      includeMembers || (marketing && groupIds.length > 0)
        ? this.userContactClient.findSmsAudience(false)
        : Promise.resolve([]),
      this.repository.findGroupRecipients(groupIds),
    ]);
    const optedOut = marketing
      ? await this.repository.findOptedOut([...new Set(groupRows.map((row) => toKrE164(row.phone)))])
      : new Set<string>();
    return mergeCampaignAudience({ members, includeMembers, groupRows, marketing, optedOut });
  }

  async preview(dto: PreviewSmsCampaignDto): Promise<SmsCampaignPreview> {
    const now = new Date();
    const [audience, ahead, devices] = await Promise.all([
      this.resolveAudience(dto),
      this.repository.countPending(),
      this.activeDevices(now),
    ]);
    const recipients = audience.recipients.length;
    const estimate = estimateBulkSchedule(devices, now, dto.sendAt ? new Date(dto.sendAt) : now, ahead, recipients);
    return {
      recipients,
      excluded: audience.excluded,
      duplicates: audience.duplicates,
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
    const campaignIds = campaigns.map((c) => c.campaignId);
    const [counts, clicked, devices, pendingSingles, creators] = await Promise.all([
      this.repository.countByCampaign(campaignIds),
      this.repository.countClickedByCampaign(campaignIds),
      this.activeDevices(now),
      this.repository.countPending(true),
      this.loadCreators([...new Set(campaigns.map((c) => c.createdBy))]),
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
        createdByName: creators.get(campaign.createdBy)?.username ?? null,
        createdAt: campaign.createdAt,
        counts: {
          total,
          pending,
          sent: byStatus('SENT'),
          failed: byStatus('FAILED'),
          cancelled: byStatus('CANCELLED'),
        },
        clicked: clicked.get(campaign.campaignId) ?? 0,
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

  async clicks(campaignId: string): Promise<SmsCampaignClick[]> {
    if (!(await this.repository.findCampaign(campaignId))) {
      throw new NotFoundError(`대량 발송을 찾을 수 없습니다: ${campaignId}`);
    }
    return this.repository.listCampaignClicks(campaignId);
  }

  private stateOf(campaign: NotificationCampaign, pending: number, now: Date): SmsCampaignState {
    if (campaign.status === 'CANCELLED') return 'CANCELLED';
    if (pending === 0) return 'COMPLETED';
    if (campaign.sendAt && campaign.sendAt > now) return 'SCHEDULED';
    return 'PROCESSING';
  }

  private async loadCreators(userIds: string[]): Promise<Map<string, UserContact>> {
    try {
      return await this.userContactClient.findContacts(userIds);
    } catch (error) {
      this.logger.warn(`대량 발송 작성자 이름 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return new Map();
    }
  }

  private async activeDevices(now: Date): Promise<(SmsDeviceStatus & BulkDevice)[]> {
    const devices = await this.deviceReader.loadStatuses(now);
    return devices.filter((d) => isSendable({ ...d, sentToday: 0 }, now));
  }
}
