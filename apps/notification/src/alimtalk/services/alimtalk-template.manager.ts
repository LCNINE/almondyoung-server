import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, UserContactClient } from '@app/shared';
import { NhnAlimtalkClient, NhnTemplateInput } from '../clients/nhn-alimtalk.client';
import { AlimtalkTestSendDto, CreateAlimtalkTemplateDto, UpdateAlimtalkTemplateDto } from '../dto';
import { AlimtalkRepository } from '../repositories/alimtalk.repository';
import { AlimtalkTemplateReader, AlimtalkTemplateView } from './alimtalk-template.reader';
import { maskPhone } from '../utils/mask-phone';
import { Channel } from '../../shared/enums';
import { getContactForChannel } from '../../shared/utils/contact.utils';

export interface AlimtalkTestSendResult {
  sentTo: string;
  requestId: string;
}

@Injectable()
export class AlimtalkTemplateManager {
  private readonly logger = new Logger(AlimtalkTemplateManager.name);

  constructor(
    private readonly client: NhnAlimtalkClient,
    private readonly reader: AlimtalkTemplateReader,
    private readonly repository: AlimtalkRepository,
    private readonly userContactClient: UserContactClient,
  ) {}

  async create(dto: CreateAlimtalkTemplateDto): Promise<AlimtalkTemplateView> {
    if (await this.reader.exists(dto.templateCode)) {
      throw new ConflictError(`'${dto.templateCode}' 코드의 템플릿이 이미 있습니다`);
    }
    await this.client.createTemplate(dto.templateCode, toInput(dto));
    return this.reader.get(dto.templateCode);
  }

  /**
   * 카카오는 템플릿을 고치면 처음부터 다시 심사한다. 승인된 템플릿이면 재승인까지 그 템플릿으로 보내는 모든 것이
   * 실패하므로 — 켜진 이벤트 알림이나 아직 나가지 않은 대량 발송이 쓰고 있으면 막고, 아니면 확인을 받는다.
   */
  async update(templateCode: string, dto: UpdateAlimtalkTemplateDto): Promise<AlimtalkTemplateView> {
    const template = await this.reader.get(templateCode);
    if (template.status === 'TSC02') {
      throw new BadRequestError('검수 중인 템플릿은 고칠 수 없습니다. 심사 결과가 나온 뒤에 고치세요');
    }
    const activeEvents = template.linkedEvents.filter((e) => e.isActive);
    if (activeEvents.length > 0) {
      throw new ConflictError(
        `켜져 있는 알림이 이 템플릿을 씁니다: ${activeEvents.map((e) => e.name).join(', ')}. 알림을 먼저 끄세요`,
      );
    }
    if ((await this.repository.countPendingByTemplate(templateCode)) > 0) {
      throw new ConflictError('아직 나가지 않은 대량 발송이 이 템플릿을 씁니다. 발송이 끝나거나 중지한 뒤에 고치세요');
    }
    if (template.status === 'TSC03' && dto.acknowledgeReReview !== true) {
      throw new BadRequestError(
        '승인된 템플릿을 고치면 다시 심사를 받고, 승인될 때까지 이 템플릿으로 보낼 수 없습니다',
      );
    }
    await this.client.updateTemplate(templateCode, toInput(dto));
    return this.reader.get(templateCode);
  }

  async comment(templateCode: string, comment: string): Promise<AlimtalkTemplateView> {
    await this.reader.get(templateCode);
    await this.client.addComment(templateCode, comment.trim());
    return this.reader.get(templateCode);
  }

  /** 운영에서 잘못 나가지 않게 로그인한 관리자 본인 번호로만 보낸다. */
  async testSend(templateCode: string, adminUserId: string, dto: AlimtalkTestSendDto): Promise<AlimtalkTestSendResult> {
    const template = await this.reader.getApproved(templateCode);
    const values = Object.fromEntries(dto.variables.map((v) => [v.name, v.value]));
    const missing = template.variables.filter((name) => !values[name]?.trim());
    if (missing.length > 0) throw new BadRequestError(`값을 넣지 않은 변수가 있습니다: ${missing.join(', ')}`);

    const own = (await this.userContactClient.findContacts([adminUserId])).get(adminUserId)?.phoneNumber;
    const phone = getContactForChannel({ userId: adminUserId, phoneNumber: own ?? undefined }, Channel.KAKAO);
    if (!phone) throw new BadRequestError('내 계정에 휴대폰 번호가 없어 시험 발송을 할 수 없습니다');

    const result = await this.client.sendTemplateBatch({
      templateCode,
      senderGroupingKey: `test:${adminUserId}`.slice(0, 100),
      recipients: [
        {
          recipientNo: phone,
          templateParameter: Object.fromEntries(template.variables.map((name) => [name, values[name]])),
          recipientGroupingKey: `test:${adminUserId}`.slice(0, 100),
        },
      ],
    });
    const outcome = result.results[0];
    if (!outcome || outcome.resultCode !== 0) {
      throw new BadRequestError(`NHN 이 시험 발송을 받지 않았습니다: ${outcome?.resultMessage ?? '결과 없음'}`);
    }
    this.logger.log(`알림톡 시험 발송 templateCode=${templateCode} admin=${adminUserId} requestId=${result.requestId}`);
    return { sentTo: maskPhone(phone), requestId: result.requestId };
  }
}

function toInput(dto: UpdateAlimtalkTemplateDto): NhnTemplateInput {
  return {
    templateName: dto.templateName.trim(),
    templateContent: dto.templateContent,
    categoryCode: dto.categoryCode,
    buttons: dto.buttons.map((b, i) => ({
      ordering: i + 1,
      type: 'WL' as const,
      name: b.name.trim(),
      linkMo: b.linkMo.trim(),
      ...(b.linkPc?.trim() && { linkPc: b.linkPc.trim() }),
    })),
  };
}
