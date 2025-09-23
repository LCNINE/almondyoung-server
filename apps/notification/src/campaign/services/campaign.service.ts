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
    // 채널별 콘텐츠 관리 메서드들
    async setChannelContent(campaignId: string, channel: string, content: any): Promise<any> {
        const campaign = await this.findById(campaignId);
        
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${campaignId} not found`);
        }

        // 기존 콘텐츠 가져오기
        const existingContent = campaign.content || {};
        
        // 채널별 콘텐츠 업데이트
        const updatedContent = {
            ...existingContent,
            [channel.toUpperCase()]: content
        };

        // 캠페인 업데이트
        await this.db
            .update(notificationCampaigns)
            .set({ 
                content: updatedContent,
                updatedAt: new Date()
            })
            .where(eq(notificationCampaigns.campaignId, campaignId));

        return {
            campaignId,
            channel: channel.toUpperCase(),
            content: content,
            message: 'Channel content updated successfully'
        };
    }

    async getChannelContent(campaignId: string, channel: string): Promise<any> {
        const campaign = await this.findById(campaignId);
        
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${campaignId} not found`);
        }

        const content = campaign.content?.[channel.toUpperCase()];
        
        return {
            campaignId,
            channel: channel.toUpperCase(),
            content: content || null,
            message: content ? 'Channel content found' : 'No content for this channel'
        };
    }

    async previewChannelContent(campaignId: string, channel: string, payload: any): Promise<any> {
        const campaign = await this.findById(campaignId);
        
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${campaignId} not found`);
        }

        const content = campaign.content?.[channel.toUpperCase()];
        
        if (!content) {
            throw new BadRequestException(`No content found for channel ${channel}`);
        }

        // 간단한 템플릿 렌더링 (실제로는 TemplateRendererService 사용)
        const renderedContent = this.renderTemplate(content, payload);

        return {
            campaignId,
            channel: channel.toUpperCase(),
            originalContent: content,
            renderedContent: renderedContent,
            payload: payload
        };
    }

    private renderTemplate(content: any, payload: any): any {
        // 간단한 템플릿 렌더링 로직
        if (typeof content === 'string') {
            return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
                return payload[key] || match;
            });
        }
        
        if (typeof content === 'object') {
            const rendered = { ...content };
            for (const [key, value] of Object.entries(rendered)) {
                if (typeof value === 'string') {
                    rendered[key] = value.replace(/\{\{(\w+)\}\}/g, (match, key) => {
                        return payload[key] || match;
                    });
                }
            }
            return rendered;
        }
        
        return content;
    }

    // 타겟 그룹 관리 메서드들
    async addTargetGroup(campaignId: string, targetGroup: any): Promise<any> {
        const campaign = await this.findById(campaignId);
        
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${campaignId} not found`);
        }

        // 타겟 그룹 생성 (실제로는 campaignTargetGroups 테이블에 저장)
        const newTargetGroup = {
            campaignId,
            name: targetGroup.name,
            type: targetGroup.type,
            criteria: targetGroup.criteria,
            userList: targetGroup.userList,
            userCount: targetGroup.userList?.length || 0
        };

        return {
            campaignId,
            targetGroup: newTargetGroup,
            message: 'Target group added successfully'
        };
    }

    async getTargetGroups(campaignId: string): Promise<any> {
        const campaign = await this.findById(campaignId);
        
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${campaignId} not found`);
        }

        // 실제로는 campaignTargetGroups 테이블에서 조회
        return {
            campaignId,
            targetGroups: [],
            message: 'Target groups retrieved successfully'
        };
    }

    async previewTargetGroup(campaignId: string, groupId: string): Promise<any> {
        const campaign = await this.findById(campaignId);
        
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${campaignId} not found`);
        }

        // 타겟 그룹 미리보기 로직
        return {
            campaignId,
            groupId,
            preview: {
                estimatedRecipients: 0,
                channels: campaign.channels,
                content: campaign.content
            },
            message: 'Target group preview generated'
        };
    }
}
