// apps/notification/src/bulk/services/bulk-notification.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DbService, InjectTypedDb } from '@app/db';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';
import { NotificationCategory } from '../../shared/enums';
import { eq, and, desc, or, like, inArray, sql } from 'drizzle-orm';

@Injectable()
export class BulkNotificationService {
  private readonly logger = new Logger(BulkNotificationService.name);

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly db: DbService<typeof notificationTables>,
    @InjectQueue('bulk-notification') private bulkNotificationQueue: Queue,
  ) {}

  async createBulkNotification(dto: CreateBulkNotificationDto): Promise<{ campaignId: string; status: string }> {
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
        metadata: dto.metadata || {}, // 캠페인 단위 공통 메타데이터 저장
      })
      .returning();

    if (!campaign) {
      throw new BadRequestException('Failed to create notification campaign');
    }

    // 2. Create Campaign Target Group Record
    // 프론트에서 이미 조인/필터링된 사용자 정보를 받아서 그대로 저장
    const userList = dto.audience.users || [];
    const [targetGroup] = await this.db.db
      .insert(notificationTables.campaignTargetGroups)
      .values({
        campaignId: campaign.campaignId,
        name: `${dto.name} - Audience`,
        type: dto.audience.kind === 'ALL_USERS' ? 'all' : dto.audience.kind === 'SELECTED_USERS' ? 'excel' : 'filter', // Map to schema enum
        criteria: dto.audience.criteria,
        userList: userList, // 프론트에서 받은 완성된 사용자 정보 객체 배열
        userCount: userList.length, // 프론트에서 이미 필터링된 사용자 수
      })
      .returning();

    if (!targetGroup) {
      throw new BadRequestException('Failed to create campaign target group');
    }

    // 3. Add to queue for processing
    // 딜레이가 음수가 되지 않도록 보정
    const delayMs = dto.sendAt ? Math.max(0, new Date(dto.sendAt).getTime() - Date.now()) : 0;

    await this.bulkNotificationQueue.add(
      'process-bulk-campaign',
      {
        campaignId: campaign.campaignId,
        targetGroupId: targetGroup.groupId,
      },
      {
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Calculate next status
    const nextStatus = dto.sendAt && new Date(dto.sendAt) > new Date() ? 'SCHEDULED' : 'PROCESSING';

    await this.db.db
      .update(notificationTables.notificationCampaigns)
      .set({ status: nextStatus })
      .where(eq(notificationTables.notificationCampaigns.campaignId, campaign.campaignId));

    this.logger.log(
      `Bulk notification campaign ${campaign.campaignId} created and added to queue with status: ${nextStatus}`,
    );

    return {
      campaignId: campaign.campaignId,
      status: nextStatus, // Return the updated status
    };
  }

  async findAllCampaigns(filters?: {
    status?: string[];
    category?: string;
    createdBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ campaigns: any[]; total: number }> {
    const conditions: any[] = [];
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    if (filters?.status && filters.status.length > 0) {
      conditions.push(inArray(notificationTables.notificationCampaigns.status, filters.status as any));
    }
    if (filters?.category) {
      conditions.push(eq(notificationTables.notificationCampaigns.category, filters.category as any));
    }
    if (filters?.createdBy) {
      conditions.push(eq(notificationTables.notificationCampaigns.createdBy, filters.createdBy));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [campaigns, totalResult] = await Promise.all([
      this.db.db.query.notificationCampaigns.findMany({
        where: whereClause,
        orderBy: (campaigns, { desc }) => [desc(campaigns.createdAt)],
        limit,
        offset,
      }),
      this.db.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationTables.notificationCampaigns)
        .where(whereClause),
    ]);

    return {
      campaigns: campaigns || [],
      total: totalResult[0]?.count || 0,
    };
  }

  async findCampaignById(campaignId: string): Promise<any> {
    const campaign = await this.db.db.query.notificationCampaigns.findFirst({
      where: eq(notificationTables.notificationCampaigns.campaignId, campaignId),
      with: {
        // targetGroups는 relation이 정의되어 있지 않을 수 있으므로 별도 조회
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }

    // 타겟 그룹 조회
    const targetGroups = await this.db.db.query.campaignTargetGroups.findMany({
      where: eq(notificationTables.campaignTargetGroups.campaignId, campaignId),
    });

    // 수신자 통계 조회
    const recipients = await this.db.db.query.campaignRecipients.findMany({
      where: eq(notificationTables.campaignRecipients.campaignId, campaignId),
    });

    const stats = {
      total: recipients.length,
      sent: recipients.filter((r) => r.status === 'SENT').length,
      failed: recipients.filter((r) => r.status === 'FAILED').length,
    };

    return {
      ...campaign,
      targetGroups,
      stats,
    };
  }

  async cancelCampaign(campaignId: string): Promise<{ success: boolean; message: string }> {
    const campaign = await this.db.db.query.notificationCampaigns.findFirst({
      where: eq(notificationTables.notificationCampaigns.campaignId, campaignId),
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }

    // 취소 가능한 상태만 취소 (PROCESSING, SCHEDULED)
    if (!['PROCESSING', 'SCHEDULED', 'DRAFT'].includes(campaign.status)) {
      throw new BadRequestException(`Cannot cancel campaign with status ${campaign.status}`);
    }

    // 큐에서 해당 캠페인 job 제거 (Bull queue에서 job 찾아서 제거)
    // 주의: 이미 실행 중인 job은 취소 불가
    const jobs = await this.bulkNotificationQueue.getJobs(['waiting', 'delayed']);
    for (const job of jobs) {
      if (job.data?.campaignId === campaignId) {
        await job.remove();
      }
    }

    // 캠페인 상태를 CANCELLED로 변경
    await this.db.db
      .update(notificationTables.notificationCampaigns)
      .set({ status: 'CANCELLED' })
      .where(eq(notificationTables.notificationCampaigns.campaignId, campaignId));

    this.logger.log(`Campaign ${campaignId} cancelled`);

    return {
      success: true,
      message: 'Campaign cancelled successfully',
    };
  }

  async getCampaignRecipients(
    campaignId: string,
    filters?: {
      status?: string;
      channel?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ recipients: any[]; total: number }> {
    const conditions: any[] = [eq(notificationTables.campaignRecipients.campaignId, campaignId)];
    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;

    if (filters?.status) {
      conditions.push(eq(notificationTables.campaignRecipients.status, filters.status));
    }
    if (filters?.channel) {
      conditions.push(eq(notificationTables.campaignRecipients.channel, filters.channel as any));
    }

    const whereClause = and(...conditions);

    const [recipients, totalResult] = await Promise.all([
      this.db.db.query.campaignRecipients.findMany({
        where: whereClause,
        orderBy: (recipients, { desc }) => [desc(recipients.attemptedAt)],
        limit,
        offset,
      }),
      this.db.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationTables.campaignRecipients)
        .where(whereClause),
    ]);

    return {
      recipients: recipients || [],
      total: totalResult[0]?.count || 0,
    };
  }
}
