// apps/notification/src/campaign/services/campaign.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import {
    notificationCampaigns,
    NotificationCampaign,
    NewNotificationCampaign
} from '../../../database/schemas/notification-schema';
import {
    CreateCampaignDto,
    UpdateCampaignDto,
    CampaignFilterDto,
} from '../dto';
import { CampaignTargetingService } from './campaign-targeting.service';

@Injectable()
export class CampaignService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        @InjectQueue('campaign') private campaignQueue: Queue,
        private readonly targetingService: CampaignTargetingService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async findAll(filter: CampaignFilterDto): Promise<NotificationCampaign[]> {
        let whereCondition: any = undefined;

        if (filter.status) {
            whereCondition = eq(notificationCampaigns.status, filter.status as any);
        }

        return this.db.query.notificationCampaigns.findMany({
            where: whereCondition,
        });
    }

    async findById(id: string): Promise<NotificationCampaign> {
        const campaign = await this.db.query.notificationCampaigns.findFirst({
            where: eq(notificationCampaigns.campaignId, id)
        });

        if (!campaign) {
            throw new NotFoundException(`Campaign ${id} not found`);
        }

        return campaign;
    }

    async create(dto: CreateCampaignDto): Promise<NotificationCampaign> {
        return this.db.transaction(async (tx) => {
            const newCampaign: NewNotificationCampaign = {
                name: dto.name,
                description: dto.description,
                category: dto.category || 'MARKETING',
                channels: dto.channels, // 관리자가 선택한 채널들
                templateId: dto.templateId,
                content: dto.content,
                sendAt: dto.sendAt ? new Date(dto.sendAt) : null,
                priority: dto.priority || 'NORMAL',
                status: 'DRAFT',
                createdBy: dto.createdBy,
                metadata: dto.metadata,
            };

            const [campaign] = await tx
                .insert(notificationCampaigns)
                .values(newCampaign)
                .returning();

            // Create target groups
            if (dto.targetGroups?.length > 0) {
                await this.targetingService.createTargetGroups(campaign.campaignId, dto.targetGroups, tx);
            }

            return campaign;
        });
    }

    async update(id: string, dto: UpdateCampaignDto): Promise<NotificationCampaign> {
        const campaign = await this.findById(id);

        if (campaign.status !== 'DRAFT') {
            throw new BadRequestException('Only draft campaigns can be updated');
        }

        const updateData: any = {
            ...dto,
            updatedAt: new Date(),
        };

        // Convert sendAt string to Date if provided
        if (dto.sendAt) {
            updateData.sendAt = new Date(dto.sendAt);
        }

        const [updated] = await this.db
            .update(notificationCampaigns)
            .set(updateData)
            .where(eq(notificationCampaigns.campaignId, id))
            .returning();

        return updated;
    }

    async approve(id: string, approvedBy: string): Promise<NotificationCampaign> {
        const campaign = await this.findById(id);

        if (campaign.status !== 'DRAFT') {
            throw new BadRequestException('Only draft campaigns can be approved');
        }

        const [result] = await this.db
            .update(notificationCampaigns)
            .set({
                status: 'SCHEDULED',
                approvedBy,
                approvedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(notificationCampaigns.campaignId, id))
            .returning();

        if (campaign.sendAt) {
            const delay = new Date(campaign.sendAt).getTime() - Date.now();
            await this.campaignQueue.add(
                'send-campaign',
                { campaignId: id },
                { delay: delay > 0 ? delay : 0 }
            );
        }

        return result;
    }

    async send(id: string): Promise<{ message: string }> {
        const campaign = await this.findById(id);

        if (campaign.status !== 'SCHEDULED') {
            throw new BadRequestException('Campaign must be approved before sending');
        }

        await this.campaignQueue.add('send-campaign', { campaignId: id });

        return { message: 'Campaign queued for sending' };
    }

    async cancel(id: string): Promise<NotificationCampaign> {
        const campaign = await this.findById(id);

        if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
            throw new BadRequestException('Cannot cancel campaign in current status');
        }

        const [result] = await this.db
            .update(notificationCampaigns)
            .set({
                status: 'CANCELLED',
                updatedAt: new Date(),
            })
            .where(eq(notificationCampaigns.campaignId, id))
            .returning();

        return result;
    }

    async getStats(id: string) {
        const campaign = await this.findById(id);
        return {
            campaignId: campaign.campaignId,
            name: campaign.name,
            status: campaign.status,
            channels: campaign.channels,
            stats: campaign.stats,
        };
    }

    async updateStats(id: string, stats: any) {
        await this.db
            .update(notificationCampaigns)
            .set({
                stats,
                updatedAt: new Date(),
            })
            .where(eq(notificationCampaigns.campaignId, id));
    }
}