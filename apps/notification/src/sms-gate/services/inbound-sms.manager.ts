import { Injectable, Logger } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { Channel } from '../../shared/enums';
import { isOptOutMessage, SmsReceivedWebhook } from '../utils/inbound-sms';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { toKrE164 } from '../clients/sms-gate.client';

export const OPT_OUT_REPLY = '[아몬드영] 광고성 문자 수신거부가 처리되었습니다.';

@Injectable()
export class InboundSmsManager {
  private readonly logger = new Logger(InboundSmsManager.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly userContactClient: UserContactClient,
  ) {}

  async handleReceived(body: SmsReceivedWebhook): Promise<void> {
    if (body.event !== 'sms:received') return;
    const { messageId, message, sender, receivedAt } = body.payload ?? {};
    if (!sender || !message) return;
    await this.save(body.deviceId, messageId, sender, message, receivedAt);
    if (!isOptOutMessage(message)) return;

    // 수신자 그룹(비회원) 발송은 회원 동의가 아니라 이 목록으로 막는다.
    await this.repository.addOptOut(toKrE164(sender));
    const { userIds, withdrawnUserIds } = await this.userContactClient.withdrawMarketingConsentByPhone(
      sender,
      'sms-reply',
    );
    this.logger.warn(`수신거부 답장 처리: 매칭 ${userIds.length}명, 철회 ${withdrawnUserIds.length}명`);
    if (messageId && (await this.repository.hasReplyFor(messageId))) return;

    await this.repository.enqueue([
      {
        // 회원이 아닌 번호(수신자 그룹)도 처리 결과를 받아야 한다. 그때는 번호를 식별자로 쓴다.
        userId: userIds[0] ?? `phone:${toKrE164(sender)}`,
        category: 'INFORMATIONAL',
        priority: 'HIGH',
        channel: Channel.SMS,
        language: 'ko',
        providerId: SMS_GATE_PROVIDER_ID,
        status: 'PENDING',
        payload: { phoneNumber: sender },
        renderedContent: { body: OPT_OUT_REPLY },
        metadata: {
          requestedDeviceId: body.deviceId ?? null,
          sentBy: 'system:opt-out-reply',
          inboundMessageId: messageId ?? null,
        },
      },
    ]);
  }

  private async save(
    deviceId: string | undefined,
    messageId: string | undefined,
    sender: string,
    message: string,
    receivedAt: string | undefined,
  ): Promise<void> {
    const phoneNumber = toKrE164(sender);
    const received = receivedAt ? new Date(receivedAt) : new Date();
    await this.repository.saveInbound({
      gatewayMessageId: messageId ?? null,
      phoneNumber,
      body: message,
      deviceId: deviceId ?? null,
      userId: await this.matchUser(phoneNumber),
      receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    });
  }

  private async matchUser(phoneNumber: string): Promise<string | null> {
    try {
      const [contact] = await this.userContactClient.findActiveContactsByPhone(phoneNumber);
      return contact?.userId ?? null;
    } catch (error) {
      this.logger.warn(`받은 문자 회원 매칭 실패: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
