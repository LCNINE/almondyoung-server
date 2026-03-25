// apps/notification/src/dispatcher/services/notification-dispatcher.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
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
import { Channel, Language, NotificationCategory, NotificationPriority, NotificationStatus } from '../../shared/enums';
import { TemplateVariableMapperService } from '../../shared/services/template-variable-mapper.service';
import { ProviderManagerService } from '../../provider/services/provider-manager.service';
import { getContactForChannel, UserProfile } from '../../shared/utils/contact.utils';

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
    @Optional() @InjectQueue('notification') private readonly notificationQueue: Queue | null,
    private readonly variableMapper: TemplateVariableMapperService,
    private readonly providerManager: ProviderManagerService,
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
        this.logger.warn(`[Dispatcher] Template not found for templateKey=${dto.templateKey}`);
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

      // 템플릿 변수 추출 및 변환
      // 명시적으로 전달된 variables 우선 사용
      let finalVariables = dto.variables;
      if (!finalVariables && template?.variablesSchema && payload) {
        // variables가 없고 템플릿 스키마가 있으면 자동 추출
        this.logger.debug(`[Dispatcher] Auto-extracting variables from payload for template ${dto.templateKey}`);
        finalVariables = this.variableMapper.extractVariablesFromPayload(payload, template.variablesSchema);
      } else if (!finalVariables && payload && template) {
        // 스키마가 없으면 경고 (의도된 동작일 수 있음)
        this.logger.warn(
          `[Dispatcher] No variables provided and no schema found for template ${dto.templateKey}, using payload as-is`,
        );
        finalVariables = payload;
      }

      // 채널별 변수 매핑
      const channelVariables = this.variableMapper.mapVariablesForChannel(channel, finalVariables || {}, {
        kakaoTemplateCode: template?.kakaoTemplateCode,
        providerTemplateId: template?.providerTemplateId,
      });

      const renderedContent = this.renderContent({
        channel,
        language,
        template,
        contentOverride: channelContentOverride,
        variables: finalVariables,
        payload,
      });

      // metadata에 채널별 템플릿 변수 정보 추가
      const channelMetadata = {
        ...metadata,
        ...(channelVariables.kakaoTemplateParameters && {
          templateCode: channelVariables.kakaoTemplateCode,
          templateParameters: channelVariables.kakaoTemplateParameters,
        }),
        ...(channelVariables.resendTemplateVariables && {
          templateId: channelVariables.resendTemplateId,
          templateVariables: channelVariables.resendTemplateVariables,
        }),
        // FCM data payload용 변수
        ...(channelVariables.fcmDataVariables && {
          fcmDataVariables: channelVariables.fcmDataVariables,
        }),
      };

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
            __variables: finalVariables ?? undefined,
          },
          renderedContent,
          status: NotificationStatus.PENDING,
          sendAt,
          attempts: 0,
          metadata: channelMetadata,
        })
        .returning();

      notificationIds.push(inserted.notificationId);

      // Redis/Bull 큐가 있으면 큐에 추가, 없으면 직접 발송
      if (this.notificationQueue) {
        const delay = Math.max(0, sendAt.getTime() - Date.now());
        try {
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
        } catch (error) {
          this.logger.warn('[Dispatcher] Failed to enqueue notification, sending directly', {
            notificationId: inserted.notificationId,
            error: error.message,
          });
          // 큐 추가 실패 시 직접 발송
          await this.sendNotificationDirectly(
            inserted.notificationId,
            channel,
            renderedContent,
            channelMetadata,
            payload,
          );
        }
      } else {
        // Redis가 없으면 직접 발송
        this.logger.log('[Dispatcher] Redis not available, sending notification directly', {
          notificationId: inserted.notificationId,
          channel,
        });
        await this.sendNotificationDirectly(
          inserted.notificationId,
          channel,
          renderedContent,
          channelMetadata,
          payload,
        );
      }
    }

    return { notificationIds };
  }

  /**
   * Redis 없이 직접 알림 발송
   */
  private async sendNotificationDirectly(
    notificationId: string,
    channel: Channel,
    renderedContent: { subject?: string; body: string; metadata?: Record<string, any> },
    metadata: Record<string, any>,
    payload: Record<string, any>,
  ): Promise<void> {
    if (!this.providerManager) {
      this.logger.error('[Dispatcher] ProviderManager not available for direct sending');
      await this.db.db
        .update(notifications)
        .set({
          status: NotificationStatus.FAILED,
          errorDetails: {
            message: 'ProviderManager not available',
            timestamp: new Date(),
          },
        })
        .where(eq(notifications.notificationId, notificationId));
      return;
    }

    try {
      // 상태를 PROCESSING으로 업데이트
      await this.db.db
        .update(notifications)
        .set({
          status: NotificationStatus.PROCESSING,
          attempts: 1,
        })
        .where(eq(notifications.notificationId, notificationId));

      // payload에서 사용자 정보 추출
      // 이벤트 payload에서 직접 정보를 가져오거나, notification 레코드에서 가져옴
      const notification = await this.db.db.query.notifications.findFirst({
        where: eq(notifications.notificationId, notificationId),
      });

      const userProfile: UserProfile = {
        userId: notification?.userId || payload?.userId || '',
        email: payload?.email || notification?.payload?.email,
        phoneNumber: payload?.phoneNumber || notification?.payload?.phoneNumber,
        pushToken: payload?.pushToken || notification?.payload?.pushToken,
        name: payload?.name || notification?.payload?.name,
      };

      const contact = getContactForChannel(userProfile, channel);
      if (!contact) {
        throw new Error(`No contact info for channel ${channel}`);
      }

      const provider = await this.providerManager.getAvailableProviderForChannel(channel);
      if (!provider) {
        throw new Error(`No provider available for channel ${channel}`);
      }

      // 프로바이더 메타데이터 구성
      const providerMetadata: Record<string, any> = {
        notificationId,
        category: payload?.category,
        priority: payload?.priority,
        ...metadata,
      };

      // 채널별 템플릿 변수 정보 추가
      if (channel === 'KAKAO' && metadata.templateCode) {
        providerMetadata.templateCode = metadata.templateCode;
        providerMetadata.templateParameters = metadata.templateParameters || {};
      }

      if (channel === 'EMAIL' && metadata.templateId) {
        providerMetadata.templateId = metadata.templateId;
        providerMetadata.templateVariables = metadata.templateVariables || {};
      }

      if (channel === 'PUSH' && metadata.fcmDataVariables) {
        providerMetadata.fcmDataVariables = metadata.fcmDataVariables;
      }

      // 실제 발송
      const result = await provider.send({
        to: contact,
        content: renderedContent.body,
        subject: renderedContent.subject,
        metadata: providerMetadata,
      });

      // 성공 시 상태 업데이트
      await this.db.db
        .update(notifications)
        .set({
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          metadata: {
            ...metadata,
            providerResponse: result.providerResponse,
            messageId: result.messageId,
          },
        })
        .where(eq(notifications.notificationId, notificationId));

      this.logger.log('[Dispatcher] Notification sent directly', {
        notificationId,
        channel,
        messageId: result.messageId,
      });
    } catch (error: any) {
      this.logger.error('[Dispatcher] Failed to send notification directly', {
        notificationId,
        channel,
        error: error.message,
      });

      // 실패 시 상태 업데이트
      await this.db.db
        .update(notifications)
        .set({
          status: NotificationStatus.FAILED,
          errorDetails: {
            message: error.message,
            stack: error.stack,
            timestamp: new Date(),
          },
        })
        .where(eq(notifications.notificationId, notificationId));
    }
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
  async getUserNotifications(userId: string, limit = 50): Promise<Notification[]> {
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
      where: and(eq(notificationEvents.eventKey, eventData.eventKey), eq(notificationEvents.isActive, true)),
    });

    if (!mapping) {
      this.logger.warn(`[Dispatcher] No active notification event mapping for key=${eventData.eventKey}`);
      throw new NotFoundException(`Notification event mapping not found for key ${eventData.eventKey}`);
    }

    const channels: Channel[] = (
      eventData.channels?.length ? eventData.channels : (mapping.defaultChannels ?? [])
    ) as Channel[];

    if (!channels.length) {
      this.logger.warn(`[Dispatcher] No channels resolved for eventKey=${eventData.eventKey}`);
      throw new BadRequestException('No channels specified for notification event');
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
    const { channel, language, template, contentOverride, variables, payload } = params;

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
      // contents 구조: { ko: { EMAIL: {...}, KAKAO: {...} }, en: { EMAIL: {...} } }
      // 또는 { EMAIL: { ko: {...}, en: {...} }, KAKAO: {...} } (레거시 구조 지원)
      let langBlock: any | undefined;

      // 먼저 새로운 구조 시도: contents.ko.EMAIL
      const langContents = template.contents[language] || template.contents['ko'] || template.contents['en'];
      if (langContents && langContents[channel]) {
        langBlock = langContents[channel];
      }
      // 레거시 구조 시도: contents.EMAIL.ko
      else {
        const channelContents = template.contents[channel];
        langBlock = channelContents?.[language] ?? channelContents?.['ko'] ?? channelContents?.['en'];
      }

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
    // 템플릿 시스템을 사용하는 채널(KAKAO, EMAIL)은 Provider에서 처리하므로
    // 여기서는 템플릿 시스템이 없는 채널(SMS, PUSH)만 치환
    const usesProviderTemplate =
      (channel === 'KAKAO' && template?.kakaoTemplateCode) || (channel === 'EMAIL' && template?.providerTemplateId);

    if (!usesProviderTemplate) {
      // 템플릿 시스템을 사용하지 않는 경우만 텍스트 치환
      if (variables && body) {
        body = this.interpolate(body, variables);
      }
      if (variables && subject) {
        subject = this.interpolate(subject, variables);
      }
    }
    // 템플릿 시스템을 사용하는 경우는 Provider에서 templateParameter/template.variables로 처리

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
