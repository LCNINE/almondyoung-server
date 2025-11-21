// apps/notification/src/dispatcher/processors/notification.processor.ts
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and, lte } from 'drizzle-orm';
import {
    notifications,
    notificationLogs,
} from '../../../database/schemas/notification-schema';
import { ProviderManagerService } from '../../provider/services/provider-manager.service';
import { NotificationLoggerService } from '../../shared/services/notification-logger.service';
import { AlertService } from '../../shared/services/alert.service';
import { Channel, NotificationStatus, NotificationPriority } from '../../shared/enums';
import { NOTIFICATION_CONSTANTS } from '../../shared/constants';
import { getContactForChannel, UserProfile } from '../../shared/utils/contact.utils';
import { StructuredLogger } from '../../shared/utils/logger.utils';

@Processor('notification')
export class NotificationProcessor {
    private readonly logger: StructuredLogger;

    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        @InjectQueue('notification') private readonly notificationQueue: Queue,
        private readonly providerManager: ProviderManagerService,
        private readonly notificationLogger: NotificationLoggerService,
        private readonly alertService: AlertService,
    ) {
        this.logger = new StructuredLogger(new Logger(NotificationProcessor.name));
    }

    private get db() {
        return this.dbService.db;
    }

    @Process('send-notification')
    async handleSendNotification(job: Job<{ notificationId: string }>) {
        const { notificationId } = job.data;
        const startTime = Date.now();

        try {
            const notification = await this.db.query.notifications.findFirst({
                where: eq(notifications.notificationId, notificationId),
            });

            if (!notification) {
                throw new Error(`Notification ${notificationId} not found`);
            }

            // 우선순위별 처리 로직
            if (notification.priority === NotificationPriority.LOW && await this.isSystemBusy()) {
                // 시스템이 바쁘면 LOW 우선순위는 지연
                await job.queue.add(
                    'send-notification',
                    { notificationId },
                    { delay: 60000 } // 1분 후
                );
                return;
            }

            await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.PROCESSING,
                    attempts: notification.attempts + 1,
                })
                .where(eq(notifications.notificationId, notificationId));

            // payload에서 사용자 정보 추출 (프론트엔드에서 전달받은 정보)
            const userProfile: UserProfile = notification.payload?.userProfile || {
                userId: notification.userId,
                email: notification.payload?.email,
                phoneNumber: notification.payload?.phoneNumber,
                pushToken: notification.payload?.pushToken,
                name: notification.payload?.name,
            };

            const contact = getContactForChannel(userProfile, notification.channel as Channel);
            if (!contact) {
                throw new Error(`No contact info for channel ${notification.channel}`);
            }

            const provider = await this.providerManager.getAvailableProviderForChannel(notification.channel as Channel);
            if (!provider) {
                throw new Error(`No provider available for channel ${notification.channel}`);
            }

            const renderedContent = notification.renderedContent as any;
            const metadata = notification.metadata as any;

            const result = await provider.send({
                to: contact,
                content: renderedContent.body,
                subject: renderedContent.subject,
                metadata: {
                    notificationId: notification.notificationId,
                    category: notification.category,
                    priority: notification.priority,
                    ...metadata,
                },
            });

            const latency = Date.now() - startTime;

            // providerResponse에서 requestId/messageId 추출하여 metadata에 저장
            // (웹훅에서 notification을 찾기 위해 필요)
            const providerResponse = result.providerResponse || {};
            const requestId = providerResponse.requestId || result.messageId;
            const updateMetadata: Record<string, any> = {
                ...metadata,
            };

            // Kakao의 경우 requestId를 metadata에 저장
            if (notification.channel === 'KAKAO' && requestId) {
                updateMetadata.requestId = requestId;
            }

            // Twilio의 경우 messageSid를 metadata에 저장
            if (notification.channel === 'SMS' && result.messageId) {
                updateMetadata.messageSid = result.messageId;
            }

            await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.SENT,
                    sentAt: new Date(),
                    providerId: provider.getProviderId(),
                    metadata: updateMetadata,
                    updatedAt: new Date(),
                })
                .where(eq(notifications.notificationId, notificationId));

            await this.notificationLogger.logNotification({
                notificationId: notification.notificationId,
                userId: notification.userId,
                eventKey: notification.eventKey || undefined,
                channel: notification.channel,
                provider: provider.getName(),
                status: NotificationStatus.SENT,
                request: {
                    to: contact,
                    channel: notification.channel,
                    template: notification.templateKey,
                },
                response: result,
                latencyMs: latency,
            });

            this.logger.log('Notification sent successfully', {
                notificationId,
                latency,
                channel: notification.channel,
                provider: provider.getName(),
            });

            return result;

        } catch (error: any) {
            this.logger.error('Failed to send notification', {
                notificationId,
                error: error.message,
            }, error.stack);

            const notificationForError = await this.db.query.notifications.findFirst({
                where: eq(notifications.notificationId, notificationId),
            });

            await this.notificationLogger.logNotification({
                notificationId,
                channel: notificationForError?.channel || 'unknown',
                provider: 'unknown',
                status: NotificationStatus.FAILED,
                request: { notificationId },
                response: { error: error.message },
                latencyMs: Date.now() - startTime,
            });

            await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.FAILED,
                    errorDetails: {
                        message: error.message,
                        stack: error.stack,
                        timestamp: new Date(),
                    },
                    updatedAt: new Date(),
                })
                .where(eq(notifications.notificationId, notificationId));

            // 재시도 로직
            const notificationForRetry = await this.db.query.notifications.findFirst({
                where: eq(notifications.notificationId, notificationId),
            });

            if (notificationForRetry && notificationForRetry.attempts < NOTIFICATION_CONSTANTS.MAX_RETRIES) {
                const retryDelay = NOTIFICATION_CONSTANTS.RETRY_DELAYS[notificationForRetry.attempts - 1];
                const nextRetryAt = new Date(Date.now() + retryDelay);

                await this.db
                    .update(notifications)
                    .set({
                        status: NotificationStatus.RETRYING,
                        nextRetryAt,
                    })
                    .where(eq(notifications.notificationId, notificationId));

                const priority = this.getRetryPriority(notificationForRetry.priority as NotificationPriority);

                await job.queue.add(
                    'send-notification',
                    { notificationId },
                    {
                        delay: retryDelay,
                        priority,
                    }
                );
            } else if (notificationForRetry) {
                await this.alertService.createAlert({
                    type: 'notification_max_retries',
                    severity: 'high',
                    title: 'Notification failed after max retries',
                    message: `Notification ${notificationId} failed after ${NOTIFICATION_CONSTANTS.MAX_RETRIES} attempts`,
                    context: {
                        notificationId,
                        userId: notificationForRetry.userId,
                        channel: notificationForRetry.channel,
                        category: notificationForRetry.category,
                        error: error.message,
                    },
                });
            }

            throw error;
        }
    }

    @Process('scheduled')
    async handleScheduledCheck(job: Job) {
        const pendingNotifications = await this.db.query.notifications.findMany({
            where: and(
                eq(notifications.status, NotificationStatus.PENDING),
                lte(notifications.sendAt, new Date())
            ),
            limit: 100,
        });

        for (const notification of pendingNotifications) {
            // 큐에 넣기 전에 상태를 PROCESSING으로 변경하여 중복 큐잉 방지
            // FOR UPDATE SKIP LOCKED를 사용하여 동시성 문제 방지
            const [updated] = await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.PROCESSING,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(notifications.notificationId, notification.notificationId),
                        eq(notifications.status, NotificationStatus.PENDING) // 상태가 여전히 PENDING인 경우만 업데이트
                    )
                )
                .returning();

            // 상태 업데이트가 성공한 경우에만 큐에 추가
            // (다른 프로세스가 이미 처리 중이면 updated가 null)
            if (updated) {
                const priority = this.getPriorityValue(notification.priority as NotificationPriority);

                await job.queue.add(
                    'send-notification',
                    { notificationId: notification.notificationId },
                    { priority }
                );
            }
        }
    }

    @OnQueueFailed()
    async handleFailure(job: Job, err: Error) {
        this.logger.error('Job failed', {
            jobId: job.id,
            jobName: job.name,
            error: err.message,
        }, err.stack);
    }

    private async isSystemBusy(): Promise<boolean> {
        // 시스템 부하 체크 로직
        const activeJobs = await this.getActiveJobsCount();
        return activeJobs > 1000; // 임계값
    }

    private async getActiveJobsCount(): Promise<number> {
        // Bull queue에서 활성 작업 수 조회
        try {
            const [active, waiting, delayed] = await Promise.all([
                this.notificationQueue.getActiveCount(),
                this.notificationQueue.getWaitingCount(),
                this.notificationQueue.getDelayedCount(),
            ]);
            return active + waiting + delayed;
        } catch (error) {
            this.logger.error('Failed to get active jobs count', { error });
            return 0; // 에러 시 0 반환하여 시스템 부하 체크를 우회
        }
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

    private getRetryPriority(originalPriority: NotificationPriority): number {
        // 재시도 시 우선순위를 높임
        const priority = this.getPriorityValue(originalPriority);
        return Math.max(1, priority - 1);
    }
}
