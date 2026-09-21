import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError, UserContactClient } from '@app/shared';
import { toKrE164 } from '../clients/sms-gate.client';
import { ReplySmsConversationDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsGateSendResult, SmsMessageManager } from './sms-message.manager';

@Injectable()
export class SmsConversationManager {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly messageManager: SmsMessageManager,
    private readonly userContactClient: UserContactClient,
  ) {}

  async delete(phoneNumber: string): Promise<void> {
    const deleted = await this.repository.deleteConversation(toKrE164(phoneNumber));
    if (deleted === 0) throw new NotFoundError(`삭제할 대화가 없습니다: ${phoneNumber}`);
  }

  async reply(dto: ReplySmsConversationDto, sentBy: string): Promise<SmsGateSendResult> {
    const phoneNumber = toKrE164(dto.phoneNumber);
    const latest = (await this.repository.findInbound(phoneNumber)).at(-1);
    if (!latest) throw new NotFoundError(`받은 문자가 없는 번호입니다: ${phoneNumber}`);
    if (!latest.deviceId) throw new BadRequestError('받은 폰을 알 수 없어 답장할 수 없습니다');

    const matched = await this.userContactClient.findActiveContactsByPhone(phoneNumber);
    const userId = (matched.find((c) => c.userId === latest.userId) ?? matched[0])?.userId;
    if (!userId) throw new BadRequestError('이 번호를 쓰는 회원이 없어 답장할 수 없습니다');

    return this.messageManager.send(
      {
        userIds: [userId],
        content: dto.content,
        category: 'INFORMATIONAL',
        deviceId: latest.deviceId,
        nhnFallback: dto.nhnFallback,
      },
      sentBy,
    );
  }
}
