import { Processor, Process } from '@nestjs/bull';
import { BadRequestException, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DbService, InjectTypedDb } from '@app/db';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { eq } from 'drizzle-orm';
import { UserIntegrationService } from '../../shared/services/user-integration.service';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { NotificationCategory, Channel } from '../../shared/enums';
import { SendNotificationDto } from '../../dispatcher/dto/send-notification.dto';

@Processor('bulk-notification')
export class BulkNotificationProcessor {
  private readonly logger = new Logger(BulkNotificationProcessor.name);

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly db: DbService<typeof notificationTables>,
    private readonly userIntegrationService: UserIntegrationService,
    private readonly notificationDispatcherService: NotificationDispatcherService,
  ) {}

  @Process('process-bulk-campaign')
  async handleProcessBulkCampaign(
    job: Job<{ campaignId: string; targetGroupId: string }>,
  ) {
    const { campaignId, targetGroupId } = job.data;
    this.logger.log(`Processing bulk campaign job for campaignId: ${campaignId}`);

    try {
      // 1. Fetch Campaign and Target Group
      const campaign = await this.db.db.query.notificationCampaigns.findFirst({
        where: eq(notificationTables.notificationCampaigns.campaignId, campaignId),
      });
      const targetGroup = await this.db.db.query.campaignTargetGroups.findFirst({
        where: eq(notificationTables.campaignTargetGroups.groupId, targetGroupId),
      });

      if (!campaign || !targetGroup) {
        this.logger.error(
          `Campaign or Target Group not found for campaignId: ${campaignId}, targetGroupId: ${targetGroupId}`,
        );
        throw new Error('Campaign or Target Group not found');
      }

      // Update campaign status to PROCESSING
      await this.db.db
        .update(notificationTables.notificationCampaigns)
        .set({ status: 'PROCESSING', updatedAt: new Date() })
        .where(eq(notificationTables.notificationCampaigns.campaignId, campaignId));

      // 2. Resolve Audience
      let targetUsers: { userId: string; email?: string; phoneNumber?: string; isMarketingEnabled?: boolean }[] = [];
      if (targetGroup.type === 'all') {
        const { users } = await this.userIntegrationService.getUsersByCriteria({});
        targetUsers = users;
      } else if (targetGroup.type === 'excel' && targetGroup.userList) {
        const { users } = await this.userIntegrationService.getUsersByCriteria({
          userIds: targetGroup.userList as string[],
        });
        targetUsers = users;
      } else if (targetGroup.type === 'filter' && targetGroup.criteria) {
        const { users } = await this.userIntegrationService.getUsersByCriteria(
          targetGroup.criteria,
        );
        targetUsers = users;
      } else {
        throw new BadRequestException('Invalid audience configuration');
      }

      // Update userCount in targetGroup
      await this.db.db
        .update(notificationTables.campaignTargetGroups)
        .set({ userCount: targetUsers.length, updatedAt: new Date() })
        .where(eq(notificationTables.campaignTargetGroups.groupId, targetGroupId));

      this.logger.log(
        `Resolved ${targetUsers.length} target users for campaign ${campaign.campaignId}`,
      );

      // 3. Filter by Marketing Consent if category is MARKETING
      let recipients = targetUsers;
      if (campaign.category === NotificationCategory.MARKETING) {
        recipients = recipients.filter(user => user.isMarketingEnabled);
        this.logger.log(
          `Filtered to ${recipients.length} users with marketing consent for campaign ${campaign.campaignId}`,
        );
      }

      // 4. Dispatch Notifications
      const notificationPromises = recipients.flatMap(user => {
        return campaign.channels.map(async (channel: Channel) => {
          const content = campaign.content?.[channel];
          if (!content) {
            this.logger.warn(
              `No content found for channel ${channel} in campaign ${campaign.campaignId}`,
            );
            return;
          }

          const userProfile = await this.userIntegrationService.getUserProfile(user.userId);

          const sendDto: SendNotificationDto = {
            userId: user.userId,
            channels: [channel],
            category: campaign.category as NotificationCategory,
            templateKey: campaign.templateId ? (await this.db.db.query.templates.findFirst({ where: eq(notificationTables.templates.templateId, campaign.templateId) }))?.templateKey : undefined,
            eventKey: `BULK_CAMPAIGN_${campaign.campaignId}`,
            payload: {
              campaignId: campaign.campaignId,
              content: content,
              targetUser: user,
            },
            correlationId: `${campaign.campaignId}-${user.userId}-${channel}`,
            priority: campaign.priority as any,
            variables: {
              name: userProfile?.name || userProfile?.email?.split('@')[0] || user.userId,
              email: userProfile?.email,
              phoneNumber: userProfile?.phoneNumber,
              subject: content.subject,
              body: content.body,
              ...content.metadata,
            },
          };
          return this.notificationDispatcherService.send(sendDto);
        });
      });

      const results = await Promise.allSettled(notificationPromises);

      // 5. Update Campaign Stats
      const sentCount = results.filter(r => r.status === 'fulfilled').length;
      const failedCount = results.filter(r => r.status === 'rejected').length;

      await this.db.db
        .update(notificationTables.notificationCampaigns)
        .set({
          status: 'COMPLETED',
          stats: {
            sent: sentCount,
            failed: failedCount,
            delivered: 0, // To be updated by receipt processing
            opened: 0,
            clicked: 0,
          },
          updatedAt: new Date(),
        })
        .where(eq(notificationTables.notificationCampaigns.campaignId, campaign.campaignId));

      this.logger.log(
        `Bulk notification campaign ${campaign.campaignId} completed. Sent: ${sentCount}, Failed: ${failedCount}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process bulk campaign ${campaignId}: ${error.message}`,
        error.stack,
      );
      await this.db.db
        .update(notificationTables.notificationCampaigns)
        .set({ status: 'FAILED', updatedAt: new Date(), metadata: { error: error.message } })
        .where(eq(notificationTables.notificationCampaigns.campaignId, campaignId));
    }
  }
}
