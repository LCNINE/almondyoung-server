// apps/notification/src/bulk/processors/bulk.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { NotificationCategory, Channel } from '../../shared/enums';

@Processor('bulk-notification')
export class BulkProcessor {
  private readonly logger = new Logger(BulkProcessor.name);

  constructor(
    private readonly notificationDispatcher: NotificationDispatcherService,
  ) {}

  @Process('process-bulk-notification')
  async processBulkNotification(job: Job<{
    campaignId: string;
    channels: Channel[];
    content: any;
    category: NotificationCategory;
    priority: string;
    recipients: Array<{ userId: string; email?: string; phoneNumber?: string; name?: string }>;
  }>) {
    const { campaignId, channels, content, category, priority, recipients } = job.data;
    
    this.logger.log(`Processing bulk notification campaign: ${campaignId}`);

    try {
      this.logger.log(`Found ${recipients.length} recipients for campaign ${campaignId}`);

      // 2. 각 수신자별로 알림 발송
      const results = await Promise.allSettled(
        recipients.map(recipient => this.sendNotificationToRecipient(recipient, channels, content, category, priority))
      );

      // 3. 결과 통계 계산
      const sentCount = results.filter(r => r.status === 'fulfilled').length;
      const failedCount = results.filter(r => r.status === 'rejected').length;

      this.logger.log(`Bulk notification campaign ${campaignId} completed. Sent: ${sentCount}, Failed: ${failedCount}`);

      return {
        campaignId,
        totalRecipients: recipients.length,
        sent: sentCount,
        failed: failedCount,
      };
    } catch (error) {
      this.logger.error(`Failed to process bulk notification campaign ${campaignId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async sendNotificationToRecipient(
    recipient: { userId: string; email?: string; phoneNumber?: string; name?: string },
    channels: Channel[],
    content: any,
    category: NotificationCategory,
    priority: string
  ): Promise<void> {
    for (const channel of channels) {
      try {
        // 채널별 컨텐츠가 있는지 확인
        if (!content[channel]) {
          this.logger.warn(`No content found for channel ${channel} in campaign`);
          continue;
        }

        // 알림 발송
        await this.notificationDispatcher.send({
          userId: recipient.userId,
          channels: [channel],
          category,
          templateKey: undefined, // 대량 발송은 템플릿 없이 직접 컨텐츠 사용
          eventKey: `BULK_CAMPAIGN_${Date.now()}`,
          payload: {
            recipient,
            content: content[channel],
          },
          correlationId: `bulk-${Date.now()}-${recipient.userId}`,
          priority: priority as any,
          variables: {
            name: recipient.name || recipient.email?.split('@')[0] || recipient.userId,
            email: recipient.email,
            phoneNumber: recipient.phoneNumber,
          },
        });

        this.logger.log(`Notification sent to ${recipient.userId} via ${channel}`);
      } catch (error) {
        this.logger.error(`Failed to send notification to ${recipient.userId} via ${channel}: ${error.message}`);
        throw error;
      }
    }
  }
}
