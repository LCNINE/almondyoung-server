import { Injectable, Logger } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { Channel } from '../../shared/enums';
import { isOptOutMessage, SmsReceivedWebhook } from '../utils/inbound-sms';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

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
    const { messageId, message, sender } = body.payload ?? {};
    if (!sender || !message || !isOptOutMessage(message)) return;

    const { userIds, withdrawnUserIds } = await this.userContactClient.withdrawMarketingConsentByPhone(
      sender,
      'sms-reply',
    );
    this.logger.warn(`수신거부 답장 처리: 매칭 ${userIds.length}명, 철회 ${withdrawnUserIds.length}명`);
    if (userIds.length === 0) return;
    if (messageId && (await this.repository.hasReplyFor(messageId))) return;

    await this.repository.enqueue([
      {
        userId: userIds[0],
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
}
