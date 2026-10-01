import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestError, NotFoundError } from '@app/shared';
import { NewNotification, NewSmsTrackedLink } from '../../../database/schemas/notification-schema';
import { Channel } from '../../shared/enums';
import { CreateSmsCampaignDto } from '../dto';
import { composeSmsBody, fillName } from '../utils/sms-body';
import { isBotUserAgent, trackLinks } from '../utils/tracked-links';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsCampaignReader } from './sms-campaign.reader';

@Injectable()
export class SmsCampaignManager {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly campaignReader: SmsCampaignReader,
    private readonly configService: ConfigService,
  ) {}

  /** 명단은 지금 확정한다. 같은 번호(게이트웨이가 보내는 E.164 기준)는 회원·그룹을 통틀어 한 통만 보낸다. */
  async create(dto: CreateSmsCampaignDto, createdBy: string): Promise<{ campaignId: string; recipients: number }> {
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
    if (sendAt && sendAt.getTime() <= Date.now()) throw new BadRequestError('예약 시각은 지금 이후여야 합니다');

    const { recipients } = await this.campaignReader.resolveAudience(dto);
    if (recipients.length === 0) throw new BadRequestError('보낼 대상이 없습니다');

    const campaignId = randomUUID();
    const storefrontUrl = this.configService.get<string>('STOREFRONT_URL');
    const links: NewSmsTrackedLink[] = [];
    const rows: NewNotification[] = recipients.map((contact) => {
      const notificationId = randomUUID();
      let content = fillName(dto.content, contact.username);
      if (storefrontUrl) {
        const tracked = trackLinks(content, `${storefrontUrl}/r`);
        content = tracked.body;
        links.push(...tracked.links.map((link) => ({ ...link, notificationId, campaignId })));
      }
      return {
        notificationId,
        userId: contact.userId,
        campaignId,
        category: dto.category,
        priority: 'NORMAL',
        channel: Channel.SMS,
        language: 'ko',
        providerId: SMS_GATE_PROVIDER_ID,
        status: 'PENDING',
        sendAt,
        payload: { phoneNumber: contact.phoneNumber, username: contact.username },
        renderedContent: { body: composeSmsBody(dto.category, content) },
        metadata: {
          sentBy: createdBy,
          ...(contact.recipientGroupId && { recipientGroupId: contact.recipientGroupId }),
        },
      };
    });
    await this.repository.createCampaign(
      {
        campaignId,
        name: dto.name,
        category: dto.category,
        channels: [Channel.SMS],
        content: { SMS: { body: dto.content } },
        sendAt,
        status: sendAt ? 'SCHEDULED' : 'PROCESSING',
        metadata: {
          provider: 'sms-gate',
          recipients: rows.length,
          includeMembers: dto.includeMembers ?? false,
          recipientGroupIds: dto.groupIds ?? [],
        },
        createdBy,
      },
      rows,
      links,
    );
    return { campaignId, recipients: rows.length };
  }

  async click(code: string, userAgent?: string): Promise<{ url: string }> {
    const url = await this.repository.recordLinkClick(code, !isBotUserAgent(userAgent));
    if (!url) throw new NotFoundError(`링크를 찾을 수 없습니다: ${code}`);
    return { url };
  }

  async stop(campaignId: string): Promise<{ cancelled: number }> {
    if (!(await this.repository.findCampaign(campaignId))) {
      throw new NotFoundError(`대량 발송을 찾을 수 없습니다: ${campaignId}`);
    }
    return { cancelled: await this.repository.cancelCampaign(campaignId) };
  }
}
