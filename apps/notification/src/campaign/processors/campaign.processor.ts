// apps/notification/src/campaign/processors/campaign.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { CampaignService } from '../services/campaign.service';
import { CampaignTargetingService } from '../services/campaign-targeting.service';
import { ProviderManagerService } from '../../provider/services/provider-manager.service';
import { TemplateRendererService } from '../../shared/services/template-renderer.service';
import { TemplateService } from '../../template/services/template.service';
import { UserSyncService } from '../../shared/services/user-sync.service';
import { UserNotificationService } from '../../shared/services/user-notification.service';

@Processor('campaign')
export class CampaignProcessor {
    private readonly logger = new Logger(CampaignProcessor.name);

    constructor(
        private readonly dbService: DbService,
        private readonly campaignService: CampaignService,
        private readonly targetingService: CampaignTargetingService,
        private readonly providerManager: ProviderManagerService,
        private readonly rendererService: TemplateRendererService,
        private readonly templateService: TemplateService,
        private readonly userSync: UserSyncService,
        private readonly userNotificationService: UserNotificationService,
    ) {}

    @Process('send-campaign')
    async handleSendCampaign(job: Job<{ campaignId: string }>) {
        const { campaignId } = job.data;

        this.logger.log('Starting campaign', { campaignId });

        try {
            const campaign = await this.campaignService.findById(campaignId);
            const channels = campaign.channels || [];

            // Get content
            let contents: Record<string, any> = {};
            if (campaign.templateId) {
                const template = await this.templateService.findTemplateById(campaign.templateId);
                contents = template.contents as Record<string, any>;
            } else if (campaign.content) {
                contents = campaign.content as Record<string, any>;
            }

            // Get target users
            const targetUserIds = await this.targetingService.getTargetUsers(campaignId);
            let totalStats: Record<string, { sent: number; failed: number }> = {};
            let processedCount = 0;

            // Initialize stats
            channels.forEach((channel: string) => {
                totalStats[channel] = { sent: 0, failed: 0 };
            });

            // Process in batches
            const BATCH_SIZE = 1000;
            for (let i = 0; i < targetUserIds.length; i += BATCH_SIZE) {
                const batchUserIds = targetUserIds.slice(i, i + BATCH_SIZE);
                await this.processBatch(
                    campaignId,
                    campaign,
                    batchUserIds,
                    channels,
                    contents,
                    totalStats
                );

                processedCount += batchUserIds.length;
                await job.progress((processedCount / targetUserIds.length) * 100);
            }

            // Complete campaign
            const overallStats = {
                sent: Object.values(totalStats).reduce((sum, stat) => sum + stat.sent, 0),
                failed: Object.values(totalStats).reduce((sum, stat) => sum + stat.failed, 0),
                delivered: 0,
                opened: 0,
                clicked: 0,
                ...totalStats,
            };

            this.logger.log('Campaign completed', {
                campaignId,
                stats: overallStats,
            });

        } catch (error: any) {
            this.logger.error('Campaign failed', {
                campaignId,
                error: error.message,
            }, error.stack);

            throw error;
        }
    }

    private async processBatch(
        campaignId: string,
        campaign: any,
        batchUserIds: string[],
        channels: string[],
        contents: Record<string, any>,
        totalStats: Record<string, { sent: number; failed: number }>
    ) {
        // 마케팅 캠페인인 경우에만 수신 동의 확인
        let eligibleUserIds: string[] = batchUserIds;

        if (campaign.category === 'MARKETING') {
            // 마케팅 수신 동의한 사용자만 필터링
            eligibleUserIds = await this.getMarketingConsentUsers(batchUserIds);

            this.logger.log('Marketing consent filter applied', {
                originalCount: batchUserIds.length,
                consentedCount: eligibleUserIds.length,
            });
        }

        if (eligibleUserIds.length === 0) {
            return;
        }

        // Get user profiles
        const userProfilesMap = await this.userSync.getUserProfiles(eligibleUserIds);

        // Get user settings for language preference
        const userSettingsMap = new Map();
        for (const userId of eligibleUserIds) {
            const settings = await this.userNotificationService.getUserNotificationSettings(userId);
            if (settings) {
                userSettingsMap.set(userId, settings);
            }
        }

        // Process each channel
        for (const channel of channels) {
            const provider = await this.providerManager.getAvailableProviderForChannel(channel);
            if (!provider) {
                this.logger.warn('No provider available', { channel });
                continue;
            }

            // Filter users with valid contacts for this channel
            const usersWithContact = eligibleUserIds
                .map(userId => ({
                    userId,
                    profile: userProfilesMap.get(userId),
                }))
                .filter(u => u.profile && this.hasContactForChannel(u.profile, channel))
                .map(u => ({
                    userId: u.userId,
                    contact: this.getContactFromProfile(u.profile!, channel),
                    language: userSettingsMap.get(u.userId)?.preferredLanguage || 'ko',
                }));

            if (usersWithContact.length === 0) continue;

            // Prepare messages
            const channelContent = contents[channel];
            if (!channelContent) continue;

            const messages = await Promise.all(
                usersWithContact.map(async (user) => {
                    const langContent = channelContent[user.language] || channelContent['ko'];
                    if (!langContent) return null;

                    return {
                        to: user.contact!,
                        content: langContent.body,
                        subject: langContent.subject,
                        metadata: {
                            ...langContent.metadata,
                            campaignId,
                            userId: user.userId,
                            category: campaign.category,
                        },
                    };
                })
            );

            const validMessages = messages.filter((m): m is NonNullable<typeof m> => m !== null);

            // Send batch
            if (validMessages.length > 0) {
                const result = await provider.sendBulk(validMessages);
                totalStats[channel].sent += result.successCount || 0;
                totalStats[channel].failed += result.failureCount || 0;
            }
        }

        // Update progress stats
        await this.campaignService.updateStats(campaignId, totalStats);
    }

    private async getMarketingConsentUsers(userIds: string[]): Promise<string[]> {
        // 마케팅 수신 동의한 사용자만 조회
        return userIds; // 간단한 구현
    }

    private hasContactForChannel(profile: any, channel: string): boolean {
        switch (channel) {
            case 'EMAIL':
                return !!profile.email;
            case 'SMS':
            case 'KAKAO':
                return !!profile.phoneNumber;
            case 'PUSH':
                return !!profile.pushToken;
            default:
                return false;
        }
    }

    private getContactFromProfile(profile: any, channel: string): string | null {
        switch (channel) {
            case 'EMAIL':
                return profile.email;
            case 'SMS':
            case 'KAKAO':
                return profile.phoneNumber;
            case 'PUSH':
                return profile.pushToken;
            default:
                return null;
        }
    }
}
