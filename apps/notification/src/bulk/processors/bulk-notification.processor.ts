// apps/notification/src/bulk/processors/bulk-notification.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { BadRequestException, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DbService, InjectTypedDb } from '@app/db';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { eq } from 'drizzle-orm';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { NotificationCategory, Channel } from '../../shared/enums';
import { SendNotificationDto } from '../../dispatcher/dto/send-notification.dto';

@Processor('bulk-notification')
export class BulkNotificationProcessor {
  private readonly logger = new Logger(BulkNotificationProcessor.name);

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly db: DbService<typeof notificationTables>,
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

      if (!campaign) {
        throw new BadRequestException(`Campaign not found: ${campaignId}`);
      }

      const targetGroup = await this.db.db.query.campaignTargetGroups.findFirst({
        where: eq(notificationTables.campaignTargetGroups.groupId, targetGroupId),
      });

      if (!targetGroup) {
        throw new BadRequestException(`Target group not found: ${targetGroupId}`);
      }

      // 2. Resolve Audience - 프론트에서 이미 조인/필터링된 사용자 정보 사용
      let targetUsers: { userId: string; email?: string; phoneNumber?: string; isMarketingEnabled?: boolean }[] = [];
      
      if (targetGroup.type === 'all') {
        // ALL_USERS는 프론트에서 모든 사용자 정보를 조인해서 넘겨줘야 함
        this.logger.warn('All users target type - 프론트에서 모든 사용자 정보를 users 배열로 전달해야 함');
        targetUsers = [];
      } else if ((targetGroup.type === 'excel' || targetGroup.type === 'filter') && targetGroup.userList) {
        // 프론트에서 이미 조인/필터링된 사용자 정보 객체 배열
        if (Array.isArray(targetGroup.userList)) {
          targetUsers = (targetGroup.userList as any[]).map((user: any) => ({
            userId: user.userId || user.id,
            email: user.email,
            phoneNumber: user.phoneNumber,
            isMarketingEnabled: user.isMarketingEnabled ?? true,
          }));
        }
      } else if (targetGroup.type === 'search') {
        // search 타입도 프론트에서 검색 결과를 users 배열로 넘겨줘야 함
        if (Array.isArray(targetGroup.userList)) {
          targetUsers = (targetGroup.userList as any[]).map((user: any) => ({
            userId: user.userId || user.id,
            email: user.email,
            phoneNumber: user.phoneNumber,
            isMarketingEnabled: user.isMarketingEnabled ?? true,
          }));
        }
      } else {
        throw new BadRequestException('Invalid audience configuration');
      }

      // Update userCount in targetGroup
      await this.db.db
        .update(notificationTables.campaignTargetGroups)
        .set({ userCount: targetUsers.length })
        .where(eq(notificationTables.campaignTargetGroups.groupId, targetGroupId));

      this.logger.log(`Found ${targetUsers.length} target users for campaign ${campaignId}`);

      // 3. Process each user
      for (const user of targetUsers) {
        try {
          // Check marketing consent for marketing campaigns
          if (campaign.category === 'MARKETING' && !user.isMarketingEnabled) {
            this.logger.log(`Skipping user ${user.userId} - marketing not enabled`);
            continue;
          }

          // Determine channels based on user data
          const channels: Channel[] = [];
          if (user.email) channels.push(Channel.EMAIL);
          if (user.phoneNumber) channels.push(Channel.SMS);
          // KAKAO, PUSH는 기본적으로 추가 (실제로는 사용자 설정에 따라 결정)
          channels.push(Channel.KAKAO, Channel.PUSH);

          for (const channel of channels) {
            try {
              const sendDto: SendNotificationDto = {
                userId: user.userId,
                channels: [channel],
                category: campaign.category as NotificationCategory,
                templateKey: campaign.templateId ? (await this.db.db.query.templates.findFirst({ where: eq(notificationTables.templates.templateId, campaign.templateId) }))?.templateKey : undefined,
                payload: {
                  // 기본 사용자 정보를 페이로드에 포함
                  userName: user.userId, // 실제로는 사용자 이름이 필요
                  userEmail: user.email,
                  userPhone: user.phoneNumber,
                  // campaign.payload는 metadata에서 가져옴
                  ...(campaign.metadata as any)?.payload || {}
                },
                metadata: {
                  campaignId: campaign.campaignId,
                  targetGroupId: targetGroupId,
                  channel: channel,
                },
              };

              await this.notificationDispatcherService.send(sendDto);
              this.logger.log(`Sent ${channel} notification to user ${user.userId}`);

              // Record successful recipient for this channel
              await this.db.db.insert(notificationTables.campaignRecipients).values({
                campaignId: campaign.campaignId,
                userId: user.userId,
                channel: channel,
                status: 'SENT',
                attemptedAt: new Date(),
              });

            } catch (error) {
              this.logger.error(`Failed to send ${channel} notification to user ${user.userId}:`, error);
              
              // Record failed recipient for this channel
              await this.db.db.insert(notificationTables.campaignRecipients).values({
                campaignId: campaign.campaignId,
                userId: user.userId,
                channel: channel,
                status: 'FAILED',
                errorMessage: error.message,
                attemptedAt: new Date(),
              });
            }
          }

        } catch (error) {
          this.logger.error(`Failed to process user ${user.userId}:`, error);
        }
      }

      // 4. Update campaign status
      await this.db.db
        .update(notificationTables.notificationCampaigns)
        .set({ 
          status: 'COMPLETED'
        })
        .where(eq(notificationTables.notificationCampaigns.campaignId, campaignId));

      this.logger.log(`Completed bulk campaign processing for campaignId: ${campaignId}`);

    } catch (error) {
      this.logger.error(`Failed to process bulk campaign ${campaignId}:`, error);
      
      // Update campaign status to failed
      await this.db.db
        .update(notificationTables.notificationCampaigns)
        .set({ 
          status: 'FAILED'
        })
        .where(eq(notificationTables.notificationCampaigns.campaignId, campaignId));
      
      throw error;
    }
  }
}
