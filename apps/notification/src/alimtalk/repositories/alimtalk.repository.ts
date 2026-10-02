import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  NewNotification,
  NewNotificationCampaign,
  Notification,
  NotificationCampaign,
  notificationCampaigns,
  notificationEvents,
  notifications,
  notificationTables,
  smsGroupRecipients,
  smsRecipientGroups,
  templates,
} from '../../../database/schemas/notification-schema';
import { ALIMTALK_CAMPAIGN_PROVIDER, ALIMTALK_CAMPAIGN_PROVIDER_ID } from '../alimtalk.constants';
import { AlimtalkGroupRow } from '../utils/alimtalk-audience';

type Schema = typeof notificationTables;

const isAlimtalkRow = eq(notifications.providerId, ALIMTALK_CAMPAIGN_PROVIDER_ID);
const isAlimtalkCampaign = sql`${notificationCampaigns.metadata}->>'provider' = ${ALIMTALK_CAMPAIGN_PROVIDER}`;
const INSERT_CHUNK = 1000;

export interface RecipientGroupSummary {
  id: string;
  name: string;
  source: string | null;
  recipients: number;
}

export interface LinkedEvent {
  templateCode: string;
  eventKey: string;
  name: string;
  isActive: boolean;
}

export interface CampaignStatusCount {
  campaignId: string;
  status: Notification['status'];
  count: number;
}

@Injectable()
export class AlimtalkRepository {
  constructor(@InjectTypedDb<Schema>() private readonly dbService: DbService<Schema>) {}

  listRecipientGroups(): Promise<RecipientGroupSummary[]> {
    return this.dbService.db
      .select({
        id: smsRecipientGroups.id,
        name: smsRecipientGroups.name,
        source: smsRecipientGroups.source,
        recipients: count(smsGroupRecipients.id),
      })
      .from(smsRecipientGroups)
      .leftJoin(smsGroupRecipients, eq(smsGroupRecipients.groupId, smsRecipientGroups.id))
      .groupBy(smsRecipientGroups.id)
      .orderBy(desc(smsRecipientGroups.createdAt));
  }

  findRecipientGroupsByIds(ids: string[]): Promise<{ id: string; name: string; source: string | null }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select({ id: smsRecipientGroups.id, name: smsRecipientGroups.name, source: smsRecipientGroups.source })
      .from(smsRecipientGroups)
      .where(inArray(smsRecipientGroups.id, ids));
  }

  findGroupRecipients(groupIds: string[]): Promise<AlimtalkGroupRow[]> {
    if (groupIds.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select({
        id: smsGroupRecipients.id,
        groupId: smsGroupRecipients.groupId,
        name: smsGroupRecipients.name,
        phone: smsGroupRecipients.phone,
      })
      .from(smsGroupRecipients)
      .where(inArray(smsGroupRecipients.groupId, groupIds))
      .orderBy(asc(smsGroupRecipients.createdAt), asc(smsGroupRecipients.id));
  }

  /** 이벤트 알림(주문·멤버십 등)이 이 알림톡 템플릿을 쓰고 있는지. 켜진 알림의 템플릿을 고치면 그 알림이 멈춘다. */
  findLinkedEvents(templateCodes: string[]): Promise<LinkedEvent[]> {
    if (templateCodes.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select({
        templateCode: sql<string>`${templates.kakaoTemplateCode}`,
        eventKey: notificationEvents.eventKey,
        name: notificationEvents.name,
        isActive: notificationEvents.isActive,
      })
      .from(notificationEvents)
      .innerJoin(templates, eq(templates.templateKey, notificationEvents.templateKey))
      .where(inArray(templates.kakaoTemplateCode, templateCodes));
  }

  /** 같은 campaignId 로 다시 오면(두 번 누름·재시도) 아무것도 만들지 않고 false 를 돌려준다. */
  async createCampaign(campaign: NewNotificationCampaign, rows: NewNotification[]): Promise<boolean> {
    return this.dbService.run(async (tx) => {
      const inserted = await tx
        .insert(notificationCampaigns)
        .values(campaign)
        .onConflictDoNothing({ target: notificationCampaigns.campaignId })
        .returning({ campaignId: notificationCampaigns.campaignId });
      if (inserted.length === 0) return false;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await tx.insert(notifications).values(rows.slice(i, i + INSERT_CHUNK));
      }
      return true;
    });
  }

  async findCampaign(campaignId: string): Promise<NotificationCampaign | undefined> {
    const [row] = await this.dbService.db
      .select()
      .from(notificationCampaigns)
      .where(and(isAlimtalkCampaign, eq(notificationCampaigns.campaignId, campaignId)));
    return row;
  }

  listCampaigns(limit: number): Promise<NotificationCampaign[]> {
    return this.dbService.db
      .select()
      .from(notificationCampaigns)
      .where(isAlimtalkCampaign)
      .orderBy(desc(notificationCampaigns.createdAt))
      .limit(limit);
  }

  async countByCampaign(campaignIds: string[]): Promise<CampaignStatusCount[]> {
    if (campaignIds.length === 0) return [];
    const rows = await this.dbService.db
      .select({ campaignId: notifications.campaignId, status: notifications.status, count: count() })
      .from(notifications)
      .where(and(isAlimtalkRow, inArray(notifications.campaignId, campaignIds)))
      .groupBy(notifications.campaignId, notifications.status);
    return rows.flatMap((r) => (r.campaignId ? [{ campaignId: r.campaignId, status: r.status, count: r.count }] : []));
  }

  async cancelCampaign(campaignId: string): Promise<number> {
    return this.dbService.run(async (tx) => {
      const cancelled = await tx
        .update(notifications)
        .set({
          status: 'CANCELLED',
          errorDetails: { message: '발송을 중지했습니다', timestamp: new Date() },
          updatedAt: new Date(),
        })
        .where(and(isAlimtalkRow, eq(notifications.campaignId, campaignId), eq(notifications.status, 'PENDING')))
        .returning({ id: notifications.notificationId });
      await tx
        .update(notificationCampaigns)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(notificationCampaigns.campaignId, campaignId));
      return cancelled.length;
    });
  }

  /** 아직 나가지 않은 대량 발송이 이 템플릿을 쓰는지. 그 사이에 템플릿이 재심사로 가면 남은 건이 전부 실패한다. */
  async countPendingByTemplate(templateCode: string): Promise<number> {
    const [row] = await this.dbService.db
      .select({ pending: count() })
      .from(notifications)
      .where(
        and(
          isAlimtalkRow,
          inArray(notifications.status, ['PENDING', 'PROCESSING']),
          sql`${notifications.metadata}->>'templateCode' = ${templateCode}`,
        ),
      );
    return row?.pending ?? 0;
  }

  /** 보낼 때가 된 행 중 가장 먼저 만든 캠페인. 한 NHN 요청은 한 템플릿이라 캠페인 단위로 묶는다. */
  async findNextDueCampaignId(now: Date): Promise<string | null> {
    const [row] = await this.dbService.db
      .select({ campaignId: notifications.campaignId })
      .from(notifications)
      .where(
        and(
          isAlimtalkRow,
          eq(notifications.status, 'PENDING'),
          or(isNull(notifications.sendAt), lte(notifications.sendAt, now)),
        ),
      )
      .orderBy(asc(notifications.createdAt))
      .limit(1);
    return row?.campaignId ?? null;
  }

  /**
   * PENDING → PROCESSING 으로 한 묶음을 집는다. 바깥 조건에 status 를 다시 걸어서, 두 인스턴스가 같은 행을
   * 골라도 먼저 바꾼 쪽만 가져간다.
   */
  async claimBatch(campaignId: string, now: Date, limit: number): Promise<Notification[]> {
    const due = and(
      isAlimtalkRow,
      eq(notifications.campaignId, campaignId),
      eq(notifications.status, 'PENDING'),
      or(isNull(notifications.sendAt), lte(notifications.sendAt, now)),
    );
    const ids = this.dbService.db
      .select({ id: notifications.notificationId })
      .from(notifications)
      .where(due)
      .orderBy(asc(notifications.createdAt), asc(notifications.notificationId))
      .limit(limit);
    return this.dbService.db
      .update(notifications)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(and(inArray(notifications.notificationId, ids), eq(notifications.status, 'PENDING')))
      .returning();
  }

  /**
   * NHN 이 접수한 행. 요청 id 는 `nhnRequestId` 로 둔다 — 기존 카카오 결과 웹훅은 `metadata.requestId` 로
   * 행 하나만 찾아 고치므로, 같은 요청 id 를 1,000행에 `requestId` 로 두면 첫 행만 엉뚱하게 바뀐다.
   */
  async markSent(ids: string[], requestId: string): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date();
    await this.dbService.db
      .update(notifications)
      .set({
        status: 'SENT',
        sentAt: now,
        attempts: sql`${notifications.attempts} + 1`,
        metadata: sql`coalesce(${notifications.metadata}, '{}'::jsonb) || jsonb_build_object('nhnRequestId', ${requestId}::text)`,
        updatedAt: now,
      })
      .where(and(isAlimtalkRow, inArray(notifications.notificationId, ids)));
  }

  async markFailed(ids: string[], message: string): Promise<void> {
    if (ids.length === 0) return;
    await this.dbService.db
      .update(notifications)
      .set({
        status: 'FAILED',
        attempts: sql`${notifications.attempts} + 1`,
        errorDetails: { message, timestamp: new Date() },
        updatedAt: new Date(),
      })
      .where(and(isAlimtalkRow, inArray(notifications.notificationId, ids)));
  }

  async failPending(campaignId: string, message: string): Promise<number> {
    const rows = await this.dbService.db
      .update(notifications)
      .set({ status: 'FAILED', errorDetails: { message, timestamp: new Date() }, updatedAt: new Date() })
      .where(and(isAlimtalkRow, eq(notifications.campaignId, campaignId), eq(notifications.status, 'PENDING')))
      .returning({ id: notifications.notificationId });
    return rows.length;
  }

  /** 발송 요청 도중 프로세스가 죽어 PROCESSING 에 남은 행. 나갔는지 알 수 없어 다시 보내지 않는다. */
  async failStaleProcessing(before: Date, message: string): Promise<number> {
    const rows = await this.dbService.db
      .update(notifications)
      .set({ status: 'FAILED', errorDetails: { message, timestamp: new Date() }, updatedAt: new Date() })
      .where(and(isAlimtalkRow, eq(notifications.status, 'PROCESSING'), lt(notifications.updatedAt, before)))
      .returning({ id: notifications.notificationId });
    return rows.length;
  }

  async requestIdsOf(campaignId: string): Promise<string[]> {
    const rows = await this.dbService.db
      .selectDistinct({ requestId: sql<string>`${notifications.metadata}->>'nhnRequestId'` })
      .from(notifications)
      .where(
        and(
          isAlimtalkRow,
          eq(notifications.campaignId, campaignId),
          eq(notifications.status, 'SENT'),
          sql`${notifications.metadata} ? 'nhnRequestId'`,
        ),
      );
    return rows.map((r) => r.requestId);
  }

  /** 결과 화면에서 수신 실패 건의 받는 사람 이름을 보여 주려고 id 로 찾는다. */
  findRows(ids: string[]): Promise<Pick<Notification, 'notificationId' | 'payload'>[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select({ notificationId: notifications.notificationId, payload: notifications.payload })
      .from(notifications)
      .where(and(isAlimtalkRow, inArray(notifications.notificationId, ids)));
  }

  /** 우리 쪽에서 접수조차 못 한 행(NHN 거절·결과 불명)의 사유별 건수 */
  failureReasons(campaignId: string): Promise<{ message: string; count: number }[]> {
    return this.dbService.db
      .select({ message: sql<string>`coalesce(${notifications.errorDetails}->>'message', '')`, count: count() })
      .from(notifications)
      .where(and(isAlimtalkRow, eq(notifications.campaignId, campaignId), eq(notifications.status, 'FAILED')))
      .groupBy(sql`${notifications.errorDetails}->>'message'`);
  }
}
