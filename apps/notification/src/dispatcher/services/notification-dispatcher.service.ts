// apps/notification/src/dispatcher/services/notification-dispatcher.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DbService, InjectTypedDb } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import {
  notificationTables,
  notifications,
  templates,
  notificationEvents,
} from '../../../database/schemas/notification-schema';
import { SendNotificationDto } from '../dto/send-notification.dto';
import {
  Channel,
  Language,
  NotificationCategory,
  NotificationPriority,
  NotificationStatus,
} from '../../shared/enums';

export interface Notification {
  notificationId: string;
  userId: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  channel: Channel;
  language: string;
  status: NotificationStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly db: DbService<typeof notificationTables>,
    @InjectQueue('notification') private readonly notificationQueue: Queue,
  ) {}

  /**
   * 공통 알림 발송 진입점
   * - 채널 수 만큼 notifications 레코드 생성
   * - Bull 큐에 send-notification 잡 enqueue
   */
  async send(dto: SendNotificationDto): Promise<{ notificationIds: string[] }> {
    this.logger.log('[Dispatcher] Sending notification', {
      userId: dto.userId,
      channels: dto.channels,
      category: dto.category,
      templateKey: dto.templateKey,
      eventKey: dto.eventKey,
      correlationId: dto.correlationId,
    });

    const db = this.db.db;

    // 템플릿 조회 (있을 때만)
    let template: any | undefined;
    if (dto.templateKey) {
      template = await db.query.templates.findFirst({
        where: eq(templates.templateKey, dto.templateKey),
      });

      if (!template) {
        this.logger.warn(
          `[Dispatcher] Template not found for templateKey=${dto.templateKey}`,
        );
      }
    }

    const now = new Date();
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : now;
    const priority = dto.priority ?? NotificationPriority.NORMAL;
    const payload = dto.payload ?? {};
    const metadata = dto.metadata ?? {};

    // language: metadata.language || 'ko' 로 단순 처리
    const language = ((metadata.language as string) || Language.KO) as Language;

    const notificationIds: string[] = [];

    for (const channel of dto.channels) {
      // 채널별 override content
      const channelContentOverride = dto.content?.[channel];

      const renderedContent = this.renderContent({
        channel,
        language,
        template,
        contentOverride: channelContentOverride,
        variables: dto.variables,
        payload,
      });

      const [inserted] = await db
        .insert(notifications)
        .values({
          userId: dto.userId,
          category: dto.category,
          priority,
          channel,
          language,
          templateKey: dto.templateKey,
          eventKey: dto.eventKey,
          correlationId: dto.correlationId,
          payload: {
            ...payload,
            // 템플릿 변수도 payload에 같이 저장 (debug / 재렌더링용)
            __variables: dto.variables ?? undefined,
          },
          renderedContent,
          status: NotificationStatus.PENDING,
          sendAt,
          attempts: 0,
          metadata,
        })
        .returning();

      notificationIds.push(inserted.notificationId);

      const delay = Math.max(0, sendAt.getTime() - Date.now());

      await this.notificationQueue.add(
        'send-notification',
        { notificationId: inserted.notificationId },
        {
          delay,
          priority: this.getPriorityValue(priority),
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log('[Dispatcher] Enqueued notification job', {
        notificationId: inserted.notificationId,
        channel,
        sendAt,
        delay,
      });
    }

    return { notificationIds };
  }

  /**
   * 단일 알림 조회
   */
  async getNotification(id: string): Promise<Notification> {
    const db = this.db.db;

    const notification = await db.query.notifications.findFirst({
      where: eq(notifications.notificationId, id),
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    return notification as unknown as Notification;
  }

  /**
   * 특정 유저의 알림 목록 조회
   */
  async getUserNotifications(
    userId: string,
    limit = 50,
  ): Promise<Notification[]> {
    const db = this.db.db;

    const rows = await db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: (fields) => [desc(fields.createdAt)],
      limit,
    });

    return rows as unknown as Notification[];
  }

  /**
   * HTTP 기반 이벤트 처리용 엔드포인트에서 호출
   * - eventKey 기준으로 notification_events 매핑 조회
   * - 매핑된 템플릿/카테고리/채널로 SendNotificationDto 구성 후 send()
   */
  async processEvent(eventData: {
    eventKey: string;
    userId: string;
    payload: Record<string, any>;
    channels?: string[];
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; message: string; notificationIds?: string[] }> {
    const db = this.db.db;

    this.logger.log('[Dispatcher] Processing event', {
      eventKey: eventData.eventKey,
      userId: eventData.userId,
    });

    const mapping = await db.query.notificationEvents.findFirst({
      where: and(
        eq(notificationEvents.eventKey, eventData.eventKey),
        eq(notificationEvents.isActive, true),
      ),
    });

    if (!mapping) {
      this.logger.warn(
        `[Dispatcher] No active notification event mapping for key=${eventData.eventKey}`,
      );
      throw new NotFoundException(
        `Notification event mapping not found for key ${eventData.eventKey}`,
      );
    }

    const channels: Channel[] = (eventData.channels?.length
      ? eventData.channels
      : (mapping.defaultChannels ?? [])) as Channel[];

    if (!channels.length) {
      this.logger.warn(
        `[Dispatcher] No channels resolved for eventKey=${eventData.eventKey}`,
      );
      throw new BadRequestException(
        'No channels specified for notification event',
      );
    }

    const dto: SendNotificationDto = {
      userId: eventData.userId,
      channels,
      category: mapping.category as NotificationCategory,
      templateKey: mapping.templateKey,
      eventKey: mapping.eventKey,
      payload: eventData.payload,
      metadata: {
        ...(eventData.metadata || {}),
        eventId: mapping.eventId,
        eventKey: mapping.eventKey,
      },
      priority: mapping.priority as NotificationPriority,
    };

    const { notificationIds } = await this.send(dto);

    return {
      success: true,
      message: 'Event processed successfully',
      notificationIds,
    };
  }

  /**
   * 템플릿 + override + 변수 조합해서 최종 컨텐츠 생성
   */
  private renderContent(params: {
    channel: Channel;
    language: string; // 'ko' | 'en'
    template?: any;
    contentOverride?: {
      subject?: string;
      body: string;
      metadata?: Record<string, any>;
    };
    variables?: Record<string, any>;
    payload?: Record<string, any>;
  }): {
    subject?: string;
    body: string;
    metadata?: Record<string, any>;
  } {
    const { channel, language, template, contentOverride, variables, payload } =
      params;

    let subject: string | undefined;
    let body: string | undefined;
    let meta: Record<string, any> = {};

    // 1) DTO에서 넘긴 채널별 직접 content가 최우선
    if (contentOverride) {
      subject = contentOverride.subject;
      body = contentOverride.body;
      meta = { ...(contentOverride.metadata || {}) };
    }
    // 2) 템플릿이 있으면 템플릿 사용
    else if (template?.contents) {
      // contents 구조: { EMAIL: { ko: {...}, en: {...} }, KAKAO: {...}, ... }
      const channelContents = template.contents[channel] as any | undefined;
      const langBlock =
        channelContents?.[language] ??
        channelContents?.['ko'] ??
        channelContents?.['en'];

      if (langBlock) {
        subject = langBlock.subject;
        body = langBlock.body;
        meta = { ...(langBlock.metadata || {}) };
      }
    }

    // 3) 그래도 body가 없으면 payload를 fallback으로 사용 (debug용이라도)
    if (!body) {
      body = payload ? JSON.stringify(payload) : '';
    }

    // 4) 변수 치환
    if (variables && body) {
      body = this.interpolate(body, variables);
    }
    if (variables && subject) {
      subject = this.interpolate(subject, variables);
    }

    return {
      subject,
      body,
      metadata: meta,
    };
  }

  /**
   * {{variable}} 치환용 유틸
   */
  private interpolate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
      const value = this.resolvePath(variables, key);
      if (value === undefined || value === null) return '';
      return String(value);
    });
  }

  private resolvePath(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => {
      if (acc && typeof acc === 'object' && part in acc) {
        return acc[part];
      }
      return undefined;
    }, obj);
  }

  /**
   * Bull priority 숫자로 변환
   */
  private getPriorityValue(priority: NotificationPriority): number {
    const map: Record<NotificationPriority, number> = {
      [NotificationPriority.URGENT]: 1,
      [NotificationPriority.HIGH]: 2,
      [NotificationPriority.NORMAL]: 3,
      [NotificationPriority.LOW]: 4,
    };
    return map[priority] ?? 3;
  }
}
