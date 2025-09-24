// apps/notification/src/bulk/services/bulk-notification.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { notificationTables, NotificationCampaign, NewNotificationCampaign } from '../../../database/schemas/notification-schema';
import { eq, and } from 'drizzle-orm';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';
import { UserServiceApiService } from '../../shared/services/user-service-api.service';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { NotificationCategory, Channel } from '../../shared/enums';

@Injectable()
export class BulkNotificationService {
  private readonly logger = new Logger(BulkNotificationService.name);

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    @InjectQueue('bulk-notification') private bulkQueue: Queue,
    private readonly userServiceApi: UserServiceApiService,
    private readonly notificationDispatcher: NotificationDispatcherService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 대량 알림 발송 요청 처리
   */
  async createBulkNotification(dto: CreateBulkNotificationDto): Promise<{ campaignId: string; stats: any }> {
    this.logger.log(`Creating bulk notification campaign: ${dto.name}`);

    try {
      // 1. 캠페인 생성
      const campaign = await this.createCampaign(dto);
      this.logger.log(`Campaign created: ${campaign.campaignId}`);

      // 2. 수신자 목록 생성
      const recipients = await this.resolveRecipients(dto.audience, dto.category);
      this.logger.log(`Resolved ${recipients.length} recipients`);

      // 3. 캠페인 수신자 저장
      await this.saveCampaignRecipients(campaign.campaignId, recipients, dto.channels);

      // 4. 백그라운드 작업으로 발송 처리
      await this.bulkQueue.add('process-bulk-notification', {
        campaignId: campaign.campaignId,
        channels: dto.channels,
        content: dto.content,
        category: dto.category,
        priority: dto.priority,
      });

      return {
        campaignId: campaign.campaignId,
        stats: {
          totalRecipients: recipients.length,
          channels: dto.channels,
          status: 'PROCESSING',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to create bulk notification: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create bulk notification: ${error.message}`);
    }
  }

  /**
   * 캠페인 생성
   */
  private async createCampaign(dto: CreateBulkNotificationDto): Promise<NotificationCampaign> {
    const campaignData: NewNotificationCampaign = {
      name: dto.name,
      description: dto.description,
      category: dto.category,
      channels: dto.channels,
      content: dto.content,
      sendAt: dto.sendAt ? new Date(dto.sendAt) : new Date(),
      priority: dto.priority,
      status: 'PROCESSING',
      createdBy: dto.createdBy,
      stats: {
        sent: 0,
        delivered: 0,
        failed: 0,
        opened: 0,
        clicked: 0,
      },
    };

    const [campaign] = await this.db
      .insert(notificationTables.notificationCampaigns)
      .values(campaignData)
      .returning();

    if (!campaign) {
      throw new BadRequestException('Failed to create campaign');
    }

    return campaign;
  }

  /**
   * 수신자 목록 해결 (User Service API 호출)
   */
  private async resolveRecipients(audience: any, category: NotificationCategory): Promise<any[]> {
    let users: any[] = [];

    try {
      if (audience.kind === 'ALL_USERS') {
        // 모든 사용자 조회
        const result = await this.userServiceApi.getUsersByCriteria({
          limit: 10000, // 대량 발송 시 적절한 제한 필요
        });
        users = result.users;
      } else if (audience.kind === 'SELECTED_USERS' && audience.userIds) {
        // 선택된 사용자들 조회
        users = await this.userServiceApi.getUsersByIds(audience.userIds);
      } else if (audience.kind === 'FILTERED_USERS' && audience.criteria) {
        // 조건에 따른 사용자 조회
        const result = await this.userServiceApi.getUsersByCriteria(audience.criteria);
        users = result.users;
      } else {
        throw new BadRequestException('Invalid audience configuration');
      }

      // 마케팅 알림인 경우 마케팅 동의한 사용자만 필터링
      if (category === NotificationCategory.MARKETING) {
        users = users.filter(user => user.isMarketingEnabled);
        this.logger.log(`Filtered to ${users.length} users with marketing consent`);
      }

      return users;
    } catch (error) {
      this.logger.error(`Failed to resolve recipients: ${error.message}`);
      throw new BadRequestException(`Failed to resolve recipients: ${error.message}`);
    }
  }

  /**
   * 캠페인 수신자 저장
   */
  private async saveCampaignRecipients(campaignId: string, recipients: any[], channels: Channel[]): Promise<void> {
    const recipientData = recipients.flatMap(user => 
      channels.map(channel => ({
        campaignId,
        userId: user.userId,
        channel,
        status: 'PENDING',
        attemptedAt: new Date(),
      }))
    );

    if (recipientData.length > 0) {
      await this.db
        .insert(notificationTables.campaignRecipients)
        .values(recipientData);
    }
  }

  /**
   * 캠페인 목록 조회
   */
  async getCampaigns(): Promise<NotificationCampaign[]> {
    return this.db.query.notificationCampaigns.findMany({
      orderBy: (campaigns, { desc }) => [desc(campaigns.createdAt)],
    });
  }

  /**
   * 캠페인 상세 조회
   */
  async getCampaignById(campaignId: string): Promise<NotificationCampaign> {
    const campaign = await this.db.query.notificationCampaigns.findFirst({
      where: eq(notificationTables.notificationCampaigns.campaignId, campaignId),
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign not found: ${campaignId}`);
    }

    return campaign;
  }

  /**
   * 캠페인 통계 조회
   */
  async getCampaignStats(campaignId: string): Promise<any> {
    const campaign = await this.getCampaignById(campaignId);
    
    // 수신자 통계 조회
    const recipients = await this.db.query.campaignRecipients.findMany({
      where: eq(notificationTables.campaignRecipients.campaignId, campaignId),
    });

    const stats = {
      total: recipients.length,
      sent: recipients.filter(r => r.status === 'SENT').length,
      failed: recipients.filter(r => r.status === 'FAILED').length,
      pending: recipients.filter(r => r.status === 'PENDING').length,
      byChannel: channels.reduce((acc, channel) => {
        acc[channel] = recipients.filter(r => r.channel === channel).length;
        return acc;
      }, {}),
    };

    return {
      campaign,
      stats,
    };
  }
}
