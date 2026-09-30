import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, NotFoundError, UserContact, UserContactClient } from '@app/shared';
import { NotificationCampaign } from '../../../database/schemas/notification-schema';
import { ALIMTALK_BATCH_SIZE, ALIMTALK_CAMPAIGN_LIST_LIMIT, ALIMTALK_FAILURE_SAMPLE } from '../alimtalk.constants';
import { MembershipAudienceClient } from '../clients/membership-audience.client';
import { NhnAlimtalkClient, NhnMessageResult } from '../clients/nhn-alimtalk.client';
import { PreviewAlimtalkCampaignDto } from '../dto';
import { AlimtalkRepository, RecipientGroupSummary } from '../repositories/alimtalk.repository';
import { AlimtalkAudience, AlimtalkMember, mergeAlimtalkAudience } from '../utils/alimtalk-audience';
import { maskPhone } from '../utils/mask-phone';
import { missingVariables, parametersFor, renderVariables, VariableBinding } from '../utils/template-variables';
import { AlimtalkTemplateReader, AlimtalkTemplateView } from './alimtalk-template.reader';

export type AlimtalkCampaignState = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export interface AlimtalkRecipientGroupOption extends RecipientGroupSummary {
  /** 크롤링한 업소 그룹은 우리와 거래가 없어 알림톡으로 보낼 수 없다 */
  allowed: boolean;
}

export interface AlimtalkCampaignPreview {
  templateCode: string;
  templateName: string;
  recipients: number;
  invalid: number;
  duplicates: number;
  missingVariables: string[];
  sample: { name: string; body: string } | null;
  /** NHN 에 나눠 보내는 요청 수 (요청당 1,000명) */
  batches: number;
}

export interface AlimtalkCampaignListItem {
  campaignId: string;
  name: string;
  templateCode: string;
  templateName: string;
  sendAt: Date | null;
  state: AlimtalkCampaignState;
  createdByName: string | null;
  createdAt: Date;
  counts: { total: number; pending: number; accepted: number; failed: number; cancelled: number };
}

export interface AlimtalkCampaignResults {
  checkedAt: string;
  /** NHN 이 접수한 건의 수신 결과 */
  kakao: number;
  sms: number;
  failed: number;
  inProgress: number;
  /** NHN 이 90일이 지나 결과를 돌려주지 않는 건 */
  unknown: number;
  /** 우리 쪽에서 NHN 접수까지 못 간 건 (거절·결과 불명), 사유별 */
  notAccepted: { message: string; count: number }[];
  failures: { name: string; phone: string; reason: string }[];
}

@Injectable()
export class AlimtalkCampaignReader {
  private readonly logger = new Logger(AlimtalkCampaignReader.name);

  constructor(
    private readonly repository: AlimtalkRepository,
    private readonly templateReader: AlimtalkTemplateReader,
    private readonly client: NhnAlimtalkClient,
    private readonly userContactClient: UserContactClient,
    private readonly membershipClient: MembershipAudienceClient,
  ) {}

  async recipientGroups(): Promise<AlimtalkRecipientGroupOption[]> {
    const groups = await this.repository.listRecipientGroups();
    return groups.map((g) => ({ ...g, allowed: g.source !== 'supabase' }));
  }

  /** 미리보기와 생성이 같은 함수를 써서 확인창 숫자와 실제 발송 수가 갈리지 않는다. */
  async resolveAudience(dto: PreviewAlimtalkCampaignDto): Promise<AlimtalkAudience> {
    const groupIds = [...new Set(dto.groupIds)];
    if (dto.members === 'NONE' && groupIds.length === 0 && dto.manual.length === 0) {
      throw new BadRequestError('받는 사람을 하나 이상 고르세요');
    }
    const groups = await this.repository.findRecipientGroupsByIds(groupIds);
    const missing = groupIds.filter((id) => !groups.some((g) => g.id === id));
    if (missing.length > 0) throw new NotFoundError(`수신자 그룹을 찾을 수 없습니다: ${missing.join(', ')}`);
    const crawled = groups.filter((g) => g.source === 'supabase');
    if (crawled.length > 0) {
      throw new BadRequestError(
        `크롤링한 업소 그룹은 알림톡으로 보낼 수 없습니다 (${crawled.map((g) => g.name).join(', ')}). 우리와 거래가 없는 번호라 정보성 안내가 되지 않습니다`,
      );
    }
    const [members, groupRows] = await Promise.all([
      this.members(dto.members),
      this.repository.findGroupRecipients(groupIds),
    ]);
    return mergeAlimtalkAudience({ members, groupRows, manual: dto.manual });
  }

  async preview(dto: PreviewAlimtalkCampaignDto): Promise<AlimtalkCampaignPreview> {
    const template = await this.templateReader.getApproved(dto.templateCode);
    const audience = await this.resolveAudience(dto);
    const bindings = toBindings(dto);
    const first = audience.recipients[0];
    return {
      templateCode: template.templateCode,
      templateName: template.templateName,
      recipients: audience.recipients.length,
      invalid: audience.invalid,
      duplicates: audience.duplicates,
      missingVariables: missingVariables(template.variables, bindings),
      sample: first ? { name: first.name, body: renderBody(template, bindings, first.name) } : null,
      batches: Math.ceil(audience.recipients.length / ALIMTALK_BATCH_SIZE),
    };
  }

  async list(): Promise<AlimtalkCampaignListItem[]> {
    const now = new Date();
    const campaigns = await this.repository.listCampaigns(ALIMTALK_CAMPAIGN_LIST_LIMIT);
    const [counts, creators] = await Promise.all([
      this.repository.countByCampaign(campaigns.map((c) => c.campaignId)),
      this.loadCreators([...new Set(campaigns.map((c) => c.createdBy))]),
    ]);
    return campaigns.map((campaign) => {
      const byStatus = (status: string) =>
        counts.find((c) => c.campaignId === campaign.campaignId && c.status === status)?.count ?? 0;
      const pending = byStatus('PENDING') + byStatus('PROCESSING');
      return {
        campaignId: campaign.campaignId,
        name: campaign.name,
        templateCode: String(campaign.metadata?.templateCode ?? ''),
        templateName: String(campaign.metadata?.templateName ?? ''),
        sendAt: campaign.sendAt,
        state: stateOf(campaign, pending, now),
        createdByName: creators.get(campaign.createdBy)?.username ?? null,
        createdAt: campaign.createdAt,
        counts: {
          total: counts.filter((c) => c.campaignId === campaign.campaignId).reduce((sum, c) => sum + c.count, 0),
          pending,
          accepted: byStatus('SENT'),
          failed: byStatus('FAILED'),
          cancelled: byStatus('CANCELLED'),
        },
      };
    });
  }

  /**
   * 수신 결과는 우리가 저장하지 않고 볼 때 NHN 에 묻는다 (발송 요청 1건 = 최대 1,000명, 요청 수만큼 조회).
   * 알림톡이 안 닿으면 NHN 이 문자로 대신 보내므로, «못 받음» 은 문자까지 실패한 건만이다.
   */
  async results(campaignId: string): Promise<AlimtalkCampaignResults> {
    if (!(await this.repository.findCampaign(campaignId))) {
      throw new NotFoundError(`알림톡 발송을 찾을 수 없습니다: ${campaignId}`);
    }
    const [requestIds, notAccepted] = await Promise.all([
      this.repository.requestIdsOf(campaignId),
      this.repository.failureReasons(campaignId),
    ]);
    const acceptedCount = (await this.repository.countByCampaign([campaignId]))
      .filter((c) => c.status === 'SENT')
      .reduce((sum, c) => sum + c.count, 0);

    const messages: NhnMessageResult[] = [];
    for (const requestId of requestIds) {
      messages.push(...(await this.client.listMessageResults(requestId)));
    }
    const tally = { kakao: 0, sms: 0, failed: 0, inProgress: 0 };
    const failedMessages: NhnMessageResult[] = [];
    for (const m of messages) {
      const outcome = outcomeOf(m);
      tally[outcome] += 1;
      if (outcome === 'failed') failedMessages.push(m);
    }
    const sample = failedMessages.slice(0, ALIMTALK_FAILURE_SAMPLE);
    const rows = await this.repository.findRows(
      sample.flatMap((m) => (m.recipientGroupingKey ? [m.recipientGroupingKey] : [])),
    );
    return {
      checkedAt: new Date().toISOString(),
      ...tally,
      unknown: Math.max(0, acceptedCount - messages.length),
      notAccepted,
      failures: sample.map((m) => {
        const row = rows.find((r) => r.notificationId === m.recipientGroupingKey);
        return {
          name: String(row?.payload?.username ?? ''),
          phone: maskPhone(m.recipientNo),
          reason: m.resendStatusName || m.resultCodeName || '수신 실패',
        };
      }),
    };
  }

  private async members(audience: PreviewAlimtalkCampaignDto['members']): Promise<AlimtalkMember[]> {
    if (audience === 'NONE') return [];
    const [contacts, only] = await Promise.all([
      this.userContactClient.findSmsAudience(false),
      this.memberFilter(audience),
    ]);
    return contacts
      .filter((c) => only === null || only.has(c.userId))
      .map((c) => ({ userId: c.userId, username: c.username, phoneNumber: c.phoneNumber }));
  }

  /** 회원 전체면 null(거르지 않음). 나머지는 membership 이 준 명단으로 거른다. */
  private memberFilter(audience: PreviewAlimtalkCampaignDto['members']): Promise<Set<string> | null> {
    if (audience === 'MEMBERSHIP') return this.membershipClient.activeUserIds();
    if (audience === 'ARREARS') return this.membershipClient.arrearsUserIds();
    return Promise.resolve(null);
  }

  private async loadCreators(userIds: string[]): Promise<Map<string, UserContact>> {
    try {
      return await this.userContactClient.findContacts(userIds);
    } catch (error) {
      this.logger.warn(`알림톡 발송 작성자 이름 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return new Map();
    }
  }
}

export function toBindings(dto: PreviewAlimtalkCampaignDto): VariableBinding[] {
  return dto.variables.map((v) =>
    v.source === 'RECIPIENT_NAME'
      ? { name: v.name, source: v.source }
      : { name: v.name, source: v.source, value: v.value ?? '' },
  );
}

export function renderBody(template: AlimtalkTemplateView, bindings: VariableBinding[], name: string): string {
  return renderVariables(template.templateContent, parametersFor(bindings, name));
}

function outcomeOf(m: NhnMessageResult): 'kakao' | 'sms' | 'failed' | 'inProgress' {
  if (m.resultCode === 'MRC01') return 'kakao';
  if (m.resendStatus === 'RSC04') return 'sms';
  if (m.resendStatus === 'RSC05') return 'failed';
  if (m.resultCode === 'MRC02' && (m.resendStatus === 'RSC01' || !m.resendStatus)) return 'failed';
  if (m.messageStatus === 'FAILED' || m.messageStatus === 'CANCEL') {
    return m.resendStatus === 'RSC02' || m.resendStatus === 'RSC03' ? 'inProgress' : 'failed';
  }
  return 'inProgress';
}

function stateOf(campaign: NotificationCampaign, pending: number, now: Date): AlimtalkCampaignState {
  if (campaign.status === 'CANCELLED') return 'CANCELLED';
  if (pending === 0) return 'COMPLETED';
  if (campaign.sendAt && campaign.sendAt > now) return 'SCHEDULED';
  return 'PROCESSING';
}
