import { Injectable, Logger } from '@nestjs/common';
import { UserContact, UserContactClient } from '@app/shared';
import { Notification } from '../../../database/schemas/notification-schema';
import { toKrE164 } from '../clients/sms-gate.client';
import { ListSmsConversationsDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

const OUTBOUND_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export type ConversationMessageState = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface ConversationMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  state: ConversationMessageState | null;
  deviceId: string | null;
  viaNhn: boolean;
  sentByName: string | null;
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
    const contacts = await this.loadContacts(items.flatMap(({ inbound }) => (inbound.userId ? [inbound.userId] : [])));
    return {
      items: items.map(({ inbound, lastOutbound }) => ({
        phoneNumber: inbound.phoneNumber,
        userId: inbound.userId,
        name: inbound.userId ? (contacts.get(inbound.userId)?.username ?? null) : null,
        lastMessage:
          lastOutbound && lastOutbound.at > inbound.receivedAt
            ? { text: lastOutbound.body, receivedAt: lastOutbound.at }
            : { text: inbound.body, receivedAt: inbound.receivedAt },
      })),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async detail(phoneNumber: string): Promise<ConversationDetail> {
    const phone = toKrE164(phoneNumber);
    const [allInbound, allOutbound, currentUserId] = await Promise.all([
      this.repository.findInbound(phone),
      this.repository.findPhoneMessagesTo(phone, OUTBOUND_LIMIT),
      this.currentOwner(phone),
    ]);
    // 삭제한 대화는 그 시점 이전 기록을 감춘다. 이후 새 문자가 오면 거기서부터 다시 보인다.
    const deletedUntil = Math.max(0, ...allInbound.map((m) => m.deletedAt?.getTime() ?? 0));
    const inbound = allInbound.filter((m) => !m.deletedAt);
    const outbound = allOutbound.filter((n) => (n.sentAt ?? n.createdAt).getTime() > deletedUntil);
    const latest = inbound.at(-1);
    const userId = currentUserId === undefined ? (latest?.userId ?? null) : currentUserId;
    const senderIds = outbound.flatMap((n) => (isUuid(n.metadata?.sentBy) ? [n.metadata.sentBy] : []));
    const contacts = await this.loadContacts([...(userId ? [userId] : []), ...senderIds]);

    const messages: ConversationMessage[] = [
      ...inbound.map((m) => ({
        id: m.id,
        direction: 'inbound' as const,
        text: m.body,
        state: null,
        deviceId: m.deviceId,
        viaNhn: false,
        sentByName: null,
        createdAt: m.receivedAt,
      })),
      ...outbound.map((n) => ({
        id: n.notificationId,
        direction: 'outbound' as const,
        text: n.renderedContent?.body ?? '',
        state: STATE[n.status],
        deviceId: n.smsDeviceId,
        viaNhn: n.metadata?.route === 'nhn',
        sentByName: isUuid(n.metadata?.sentBy) ? (contacts.get(n.metadata.sentBy)?.username ?? null) : null,
        createdAt: n.sentAt ?? n.createdAt,
      })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      phoneNumber: phone,
      userId,
      name: userId ? (contacts.get(userId)?.username ?? null) : null,
      deviceId: messages.findLast((m) => m.deviceId && !m.viaNhn && (m.state === null || m.state === 'sent'))?.deviceId ?? latest?.deviceId ?? null,
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
