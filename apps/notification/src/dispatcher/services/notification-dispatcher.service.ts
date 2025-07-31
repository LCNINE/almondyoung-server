// apps/notification/src/dispatcher/services/notification-dispatcher.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, desc } from 'drizzle-orm';
import {
    notifications,
    NewNotification,
} from '../../../database/schemas/notification-schema';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { UserNotificationService } from '../../shared/services/user-notification.service';
import { TemplateService } from '../../template/services/template.service';
import { TemplateRendererService } from '../../shared/services/template-renderer.service';
import { Channel, Language, NotificationStatus, NotificationPriority } from '../../shared/enums';
import { StructuredLogger } from '../../shared/utils/logger.utils';
import { Logger } from '@nestjs/common';

@Injectable()
export class NotificationDispatcherService {
    private readonly logger: StructuredLogger;

    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        @InjectQueue('notification') private notificationQueue: Queue,
        @InjectQueue('notification-scheduled') private scheduledQueue: Queue,
        private readonly userNotificationService: UserNotificationService,
        private readonly templateService: TemplateService,
        private readonly rendererService: TemplateRendererService,
    ) {
        this.logger = new StructuredLogger(new Logger(NotificationDispatcherService.name));
    }

    private get db() {
        return this.dbService.db;
    }

    async send(dto: SendNotificationDto): Promise<{ notificationIds: string[] }> {
        // 사용자 알림 허용 확인
        const isEnabled = await this.userNotificationService.isUserNotificationEnabled(dto.userId);
        if (!isEnabled) {
            this.logger.warn('User has notifications disabled', {
                userId: dto.userId,
                category: dto.category,
            });
            return { notificationIds: [] };
        }

        const userSettings = await this.userNotificationService.getUserNotificationSettings(dto.userId);
        const language = userSettings?.preferredLanguage || Language.KO;

        const notificationIds: string[] = [];

        // 템플릿 조회
        let templateContents: any = {};
        let templateId: string | undefined;

        if (dto.templateKey) {
            const template = await this.templateService.findByKey(dto.templateKey);
            templateContents = template.contents;
            templateId = template.templateId;

            // 템플릿 카테고리와 요청 카테고리 일치 확인
            if (template.category !== dto.category) {
                this.logger.warn('Template category mismatch', {
                    templateKey: dto.templateKey,
                    templateCategory: template.category,
                    requestCategory: dto.category,
                });
            }
        }

        // 각 채널별 처리
        for (const channel of dto.channels) {
            let renderedContent: any = {};

            if (dto.templateKey && templateContents[channel]) {
                const channelContent = templateContents[channel];
                const langContent = channelContent[language] || channelContent[Language.KO];

                if (langContent) {
                    renderedContent = {
                        subject: langContent.subject
                            ? await this.rendererService.render(langContent.subject, dto.payload || {})
                            : undefined,
                        body: await this.rendererService.render(langContent.body, dto.payload || {}),
                        metadata: langContent.metadata,
                    };
                }
            } else if (dto.content?.[channel]) {
                renderedContent = dto.content[channel];
            } else {
                this.logger.warn('No content for channel', {
                    channel,
                    templateKey: dto.templateKey,
                    hasDirectContent: !!dto.content,
                });
                continue;
            }

            const newNotification: NewNotification = {
                correlationId: dto.correlationId,
                userId: dto.userId,
                eventKey: dto.eventKey,
                templateKey: dto.templateKey,
                templateId,
                category: dto.category,
                priority: dto.priority || NotificationPriority.NORMAL,
                channel: channel as any,
                language: language as any,
                payload: dto.payload,
                renderedContent,
                status: NotificationStatus.PENDING,
                sendAt: dto.sendAt ? new Date(dto.sendAt) : null,
                metadata: dto.metadata,
            };

            const [notification] = await this.db
                .insert(notifications)
                .values(newNotification)
                .returning();

            notificationIds.push(notification.notificationId);

            // 큐에 추가
            const priority = this.getPriorityValue(notification.priority as NotificationPriority);

            if (dto.sendAt) {
                const delay = new Date(dto.sendAt).getTime() - Date.now();
                await this.scheduledQueue.add(
                    'send-notification',
                    { notificationId: notification.notificationId },
                    {
                        delay: delay > 0 ? delay : 0,
                        priority,
                    }
                );
            } else {
                await this.notificationQueue.add(
                    'send-notification',
                    { notificationId: notification.notificationId },
                    { priority }
                );
            }

            this.logger.log('Notification queued', {
                notificationId: notification.notificationId,
                userId: dto.userId,
                channel,
                category: dto.category,
                priority: dto.priority,
                scheduled: !!dto.sendAt,
            });
        }

        return { notificationIds };
    }

    async getNotification(id: string) {
        return this.db.query.notifications.findFirst({
            where: eq(notifications.notificationId, id),
        });
    }

    async getUserNotifications(userId: string, limit = 50) {
        return this.db.query.notifications.findMany({
            where: eq(notifications.userId, userId),
            orderBy: desc(notifications.createdAt),
            limit,
        });
    }

    private getPriorityValue(priority: NotificationPriority): number {
        const priorityMap = {
            [NotificationPriority.URGENT]: 1,
            [NotificationPriority.HIGH]: 2,
            [NotificationPriority.NORMAL]: 3,
            [NotificationPriority.LOW]: 4,
        };
        return priorityMap[priority] || 3;
    }
}