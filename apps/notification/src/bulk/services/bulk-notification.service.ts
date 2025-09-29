import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DbService } from '@app/db';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';
import { NotificationCategory } from '../../shared/enums';
import { eq } from 'drizzle-orm';

@Injectable()
export class BulkNotificationService {
  private readonly logger = new Logger(BulkNotificationService.name);

  constructor(
    private readonly db: DbService,
    @InjectQueue('bulk-notification') private bulkNotificationQueue: Queue,
  ) {}

  async createBulkNotification(
    dto: CreateBulkNotificationDto,
  ): Promise<{ campaignId: string; status: string }> {
    this.logger.log(`Initiating bulk notification campaign creation: ${dto.name}`);

    // Get templateId if templateKey is provided
    let templateId: string | undefined;
    if (dto.templateKey) {
      const template = await this.db.db
        .select()
        .from(notificationTables.templates)
        .where(eq(notificationTables.templates.templateKey, dto.templateKey))
        .limit(1);
      templateId = template[0]?.templateId;
    }

    // 1. Create Campaign Record
    const [campaign] = await this.db.db
      .insert(notificationTables.notificationCampaigns)
      .values({
        name: dto.name,
        description: dto.description,
        category: dto.category,
        channels: dto.channels,
        templateId: templateId,
        content: dto.content,
        sendAt: dto.sendAt ? new Date(dto.sendAt) : new Date(),
        priority: dto.priority,
        createdBy: dto.createdBy,
        status: 'DRAFT', // Set to DRAFT initially
      })
      .returning();

    if (!campaign) {
      throw new BadRequestException('Failed to create notification campaign');
    }

    // 2. Create Campaign Target Group Record
    const [targetGroup] = await this.db.db
      .insert(notificationTables.campaignTargetGroups)
      .values({
        campaignId: campaign.campaignId,
        name: `${dto.name} - Audience`,
        type: dto.audience.kind === 'ALL_USERS' ? 'all' : dto.audience.kind === 'SELECTED_USERS' ? 'excel' : 'filter', // Map to schema enum
        criteria: dto.audience.criteria,
        userList: dto.audience.userIds,
        userCount: 0, // Will be updated by processor
      })
      .returning();

    if (!targetGroup) {
      throw new BadRequestException('Failed to create campaign target group');
    }

    // 3. Add to queue for processing
    await this.bulkNotificationQueue.add(
      'process-bulk-campaign',
      {
        campaignId: campaign.campaignId,
        targetGroupId: targetGroup.groupId,
      },
      {
        delay: dto.sendAt ? new Date(dto.sendAt).getTime() - Date.now() : 0, // Schedule if sendAt is in future
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    await this.db.db
      .update(notificationTables.notificationCampaigns)
      .set({ status: dto.sendAt && new Date(dto.sendAt) > new Date() ? 'SCHEDULED' : 'PROCESSING' })
      .where(eq(notificationTables.notificationCampaigns.campaignId, campaign.campaignId));

    this.logger.log(
      `Bulk notification campaign ${campaign.campaignId} created and added to queue with status: ${campaign.status}`,
    );

    return {
      campaignId: campaign.campaignId,
      status: campaign.status,
    };
  }
}
