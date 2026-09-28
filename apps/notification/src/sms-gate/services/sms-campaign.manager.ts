import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError, UserContactClient } from '@app/shared';
import { NewNotification } from '../../../database/schemas/notification-schema';
import { Channel } from '../../shared/enums';
import { CreateSmsCampaignDto } from '../dto';
import { composeSmsBody, fillName } from '../utils/sms-body';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { toKrE164 } from '../clients/sms-gate.client';

interface CampaignRecipient {
  userId: string;
  phoneNumber: string;
  username: string;
  recipientGroupId?: string;
}

@Injectable()
export class SmsCampaignManager {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly userContactClient: UserContactClient,
  ) {}

  /** 명단은 지금 확정한다. 같은 번호(게이트웨이가 보내는 E.164 기준)를 쓰는 계정이 여럿이면 한 통만 보낸다. */
  async create(dto: CreateSmsCampaignDto, createdBy: string): Promise<{ campaignId: string; recipients: number }> {
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
    if (sendAt && sendAt.getTime() <= Date.now()) throw new BadRequestError('예약 시각은 지금 이후여야 합니다');

    const audience = await this.loadAudience(dto);
    const seenPhones = new Set<string>();
    const recipients = audience.filter((contact) => {
      const phone = toKrE164(contact.phoneNumber);
      if (phone === '+82' || seenPhones.has(phone)) return false;
      seenPhones.add(phone);
      return true;
    });
    if (recipients.length === 0) throw new BadRequestError('보낼 대상이 없습니다');

    const campaignId = randomUUID();
    const rows: NewNotification[] = recipients.map((contact) => ({
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
      renderedContent: { body: composeSmsBody(dto.category, fillName(dto.content, contact.username)) },
      metadata: { sentBy: createdBy, ...(contact.recipientGroupId && { recipientGroupId: contact.recipientGroupId }) },
    }));
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
          ...(dto.groupId && { recipientGroupId: dto.groupId }),
        },
        createdBy,
      },
      rows,
    );
    return { campaignId, recipients: rows.length };
  }

  /** 그룹이면 그룹 명단(광고는 수신거부 번호 제외), 아니면 활성 회원. 그룹 행의 userId 는 회원 id 가 아니다. */
  private async loadAudience(dto: CreateSmsCampaignDto): Promise<CampaignRecipient[]> {
    const marketing = dto.category === 'MARKETING';
    if (!dto.groupId) return this.userContactClient.findSmsAudience(marketing);
    if (!(await this.repository.findRecipientGroup(dto.groupId))) {
      throw new NotFoundError(`수신자 그룹을 찾을 수 없습니다: ${dto.groupId}`);
    }
    const members = await this.repository.findGroupRecipients(dto.groupId, marketing);
    return members.map((member) => ({
      userId: `group:${member.id}`,
      phoneNumber: member.phone,
      username: member.name,
      recipientGroupId: member.groupId,
    }));
  }

  async stop(campaignId: string): Promise<{ cancelled: number }> {
    if (!(await this.repository.findCampaign(campaignId))) {
      throw new NotFoundError(`대량 발송을 찾을 수 없습니다: ${campaignId}`);
    }
    return { cancelled: await this.repository.cancelCampaign(campaignId) };
  }
}
