import { Injectable, Logger } from '@nestjs/common';
import { UserContact, UserContactClient } from '@app/shared';
import { Notification } from '../../../database/schemas/notification-schema';
import { toKrE164 } from '../clients/sms-gate.client';
import { ListSmsConversationsDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

const OUTBOUND_LIMIT = 500;

export type ConversationMessageState = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface ConversationMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  state: ConversationMessageState | null;
  deviceId: string | null;
  viaNhn: boolean;
  createdAt: Date;
}

export interface ConversationSummary {
  phoneNumber: string;
  userId: string | null;
  name: string | null;
  lastMessage: { text: string; receivedAt: Date };
}

export interface ConversationPage {
  items: ConversationSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface ConversationDetail {
  phoneNumber: string;
  userId: string | null;
  name: string | null;
  deviceId: string | null;
  messages: ConversationMessage[];
}

const STATE: Record<Notification['status'], ConversationMessageState> = {
  PENDING: 'pending',
  PROCESSING: 'sending',
  SENT: 'sent',
  DELIVERED: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'sending',
};

@Injectable()
export class SmsConversationReader {
  private readonly logger = new Logger(SmsConversationReader.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly userContactClient: UserContactClient,
  ) {}

  async list(dto: ListSmsConversationsDto): Promise<ConversationPage> {
    const { items, total } = await this.repository.pageLatestInboundPerPhone(dto.page, dto.limit, dto.q);
    const contacts = await this.loadContacts(items.flatMap((m) => (m.userId ? [m.userId] : [])));
    return {
      items: items.map((m) => ({
        phoneNumber: m.phoneNumber,
        userId: m.userId,
        name: m.userId ? (contacts.get(m.userId)?.username ?? null) : null,
        lastMessage: { text: m.body, receivedAt: m.receivedAt },
      })),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async detail(phoneNumber: string): Promise<ConversationDetail> {
    const phone = toKrE164(phoneNumber);
    const [inbound, outbound, currentUserId] = await Promise.all([
      this.repository.findInbound(phone),
      this.repository.findPhoneMessagesTo(phone, OUTBOUND_LIMIT),
      this.currentOwner(phone),
    ]);
    const latest = inbound.at(-1);
    const userId = currentUserId === undefined ? (latest?.userId ?? null) : currentUserId;
    const contacts = await this.loadContacts(userId ? [userId] : []);

    const messages: ConversationMessage[] = [
      ...inbound.map((m) => ({
        id: m.id,
        direction: 'inbound' as const,
        text: m.body,
        state: null,
        deviceId: m.deviceId,
        viaNhn: false,
        createdAt: m.receivedAt,
      })),
      ...outbound.map((n) => ({
        id: n.notificationId,
        direction: 'outbound' as const,
        text: n.renderedContent?.body ?? '',
        state: STATE[n.status],
        deviceId: n.smsDeviceId,
        viaNhn: n.metadata?.route === 'nhn',
        createdAt: n.sentAt ?? n.createdAt,
      })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      phoneNumber: phone,
      userId,
      name: userId ? (contacts.get(userId)?.username ?? null) : null,
      deviceId: latest?.deviceId ?? null,
      messages,
    };
  }

  private async currentOwner(phoneNumber: string): Promise<string | null | undefined> {
    try {
      const [contact] = await this.userContactClient.findActiveContactsByPhone(phoneNumber);
      if (!contact) return null;
      await this.repository.fillInboundUser(phoneNumber, contact.userId);
      return contact.userId;
    } catch (error) {
      this.logger.warn(`받은 문자 회원 재매칭 실패: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async loadContacts(userIds: string[]): Promise<Map<string, UserContact>> {
    try {
      return await this.userContactClient.findContacts([...new Set(userIds)]);
    } catch (error) {
      this.logger.warn(`대화 상대 이름 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return new Map();
    }
  }
}
