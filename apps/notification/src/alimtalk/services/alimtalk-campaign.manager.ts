import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { NewNotification } from '../../../database/schemas/notification-schema';
import { Channel } from '../../shared/enums';
import { ALIMTALK_CAMPAIGN_PROVIDER, ALIMTALK_CAMPAIGN_PROVIDER_ID } from '../alimtalk.constants';
import { CreateAlimtalkCampaignDto } from '../dto';
import { AlimtalkRepository } from '../repositories/alimtalk.repository';
import { missingVariables, parametersFor, renderVariables } from '../utils/template-variables';
import { AlimtalkCampaignReader, toBindings } from './alimtalk-campaign.reader';
import { AlimtalkTemplateReader } from './alimtalk-template.reader';

/** NHN 예약 발송 한도와 맞춘다 */
const MAX_SCHEDULE_DAYS = 60;

export interface AlimtalkCampaignCreated {
  campaignId: string;
  recipients: number;
  /** false 면 같은 id 로 이미 만든 발송이 있어 새로 만들지 않았다 */
  created: boolean;
}

@Injectable()
export class AlimtalkCampaignManager {
  constructor(
    private readonly repository: AlimtalkRepository,
    private readonly campaignReader: AlimtalkCampaignReader,
    private readonly templateReader: AlimtalkTemplateReader,
  ) {}

  /** 명단은 지금 확정해 받는 사람마다 한 행을 쌓는다. 실제 발송은 워커가 1,000명씩 나눠 한다. */
  async create(dto: CreateAlimtalkCampaignDto, createdBy: string): Promise<AlimtalkCampaignCreated> {
    const existing = await this.repository.findCampaign(dto.campaignId);
    if (existing)
      return {
        campaignId: existing.campaignId,
        recipients: Number(existing.metadata?.recipients ?? 0),
        created: false,
      };

    const sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
    if (sendAt && sendAt.getTime() <= Date.now()) throw new BadRequestError('예약 시각은 지금 이후여야 합니다');
    if (sendAt && sendAt.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000) {
      throw new BadRequestError(`예약은 ${MAX_SCHEDULE_DAYS}일 안으로만 할 수 있습니다`);
    }

    const template = await this.templateReader.getApproved(dto.templateCode);
    const bindings = toBindings(dto);
    const missing = missingVariables(template.variables, bindings);
    if (missing.length > 0) throw new BadRequestError(`값을 정하지 않은 변수가 있습니다: ${missing.join(', ')}`);

    const audience = await this.campaignReader.resolveAudience(dto);
    if (audience.recipients.length === 0) throw new BadRequestError('보낼 대상이 없습니다');

    const used = bindings.filter((b) => template.variables.includes(b.name));
    const rows: NewNotification[] = audience.recipients.map((recipient) => {
      const templateParameters = parametersFor(used, recipient.name);
      return {
        userId: recipient.userId,
        campaignId: dto.campaignId,
        category: 'INFORMATIONAL',
        priority: 'NORMAL',
        channel: Channel.KAKAO,
        language: 'ko',
        providerId: ALIMTALK_CAMPAIGN_PROVIDER_ID,
        status: 'PENDING',
        sendAt,
        payload: { phoneNumber: recipient.phoneNumber, username: recipient.name },
        renderedContent: { body: renderVariables(template.templateContent, templateParameters) },
        metadata: {
          sentBy: createdBy,
          templateCode: template.templateCode,
          templateParameters,
          ...(recipient.recipientGroupId && { recipientGroupId: recipient.recipientGroupId }),
        },
      };
    });

    const created = await this.repository.createCampaign(
      {
        campaignId: dto.campaignId,
        name: dto.name.trim(),
        category: 'INFORMATIONAL',
        channels: [Channel.KAKAO],
        content: { KAKAO: { body: template.templateContent } },
        sendAt,
        status: sendAt ? 'SCHEDULED' : 'PROCESSING',
        metadata: {
          provider: ALIMTALK_CAMPAIGN_PROVIDER,
          templateCode: template.templateCode,
          templateName: template.templateName,
          recipients: rows.length,
          members: dto.members,
          recipientGroupIds: [...new Set(dto.groupIds)],
          manualCount: dto.manual.length,
          invalid: audience.invalid,
          duplicates: audience.duplicates,
          variables: used,
        },
        createdBy,
      },
      rows,
    );
    return { campaignId: dto.campaignId, recipients: rows.length, created };
  }

  async stop(campaignId: string): Promise<{ cancelled: number }> {
    if (!(await this.repository.findCampaign(campaignId))) {
      throw new NotFoundError(`알림톡 발송을 찾을 수 없습니다: ${campaignId}`);
    }
    return { cancelled: await this.repository.cancelCampaign(campaignId) };
  }
}
