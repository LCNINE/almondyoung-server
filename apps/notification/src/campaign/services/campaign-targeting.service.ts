// apps/notification/src/campaign/services/campaign-targeting.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import {
    campaignTargetGroups,
    NewCampaignTargetGroup,
} from '../../../database/schemas/notification-schema';
import { TargetGroupDto } from '../dto/target-group.dto';
import { UserSearchService } from './user-search.service';
import { UserSyncService } from '../../shared/services/user-sync.service';
import { NOTIFICATION_CONSTANTS } from '../../shared/constants';

@Injectable()
export class CampaignTargetingService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly userSearchService: UserSearchService,
        private readonly userSyncService: UserSyncService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async createTargetGroups(
        campaignId: string,
        groups: TargetGroupDto[],
        tx?: any
    ) {
        const db = tx || this.db;

        for (const group of groups) {
            const userList = await this.resolveTargetGroup(group);

            const newGroup: NewCampaignTargetGroup = {
                campaignId,
                name: group.name,
                type: group.type as any,
                criteria: group.criteria,
                userList,
                userCount: userList.length,
            };

            await db.insert(campaignTargetGroups).values(newGroup);
        }
    }

    // Stream 방식으로 변경
    async *getTargetUsersStream(campaignId: string): AsyncGenerator<string[], void, unknown> {
        const groups = await this.db.query.campaignTargetGroups.findMany({
            where: eq(campaignTargetGroups.campaignId, campaignId),
        });

        for (const group of groups) {
            const userIds = group.userList as string[];

            // Yield in batches
            for (let i = 0; i < userIds.length; i += NOTIFICATION_CONSTANTS.BATCH_SIZE) {
                yield userIds.slice(i, i + NOTIFICATION_CONSTANTS.BATCH_SIZE);
            }
        }
    }

    async getTargetUsers(campaignId: string): Promise<string[]> {
        const groups = await this.db.query.campaignTargetGroups.findMany({
            where: eq(campaignTargetGroups.campaignId, campaignId),
        });

        const allUserIds = new Set<string>();

        for (const group of groups) {
            const userIds = group.userList as string[];
            userIds.forEach(id => allUserIds.add(id));
        }

        return Array.from(allUserIds);
    }

    async previewTargeting(groups: TargetGroupDto[]): Promise<{
        totalCount: number;
        groups: Array<{ name: string; count: number }>;
    }> {
        const groupResults: Array<{ name: string; count: number }> = [];
        const allUserIds = new Set<string>();

        for (const group of groups) {
            const userIds = await this.resolveTargetGroup(group);
            groupResults.push({
                name: group.name,
                count: userIds.length,
            });
            userIds.forEach(id => allUserIds.add(id));
        }

        return {
            totalCount: allUserIds.size,
            groups: groupResults,
        };
    }

    private async resolveTargetGroup(group: TargetGroupDto): Promise<string[]> {
        switch (group.type) {
            case 'all':
                return this.getAllUsers();

            case 'filter':
                return this.userSyncService.getUsersByFilter(group.criteria || {});

            case 'excel':
                return group.userList || [];

            case 'search':
                return this.userSearchService.searchUsers(group.criteria);

            default:
                return [];
        }
    }

    private async getAllUsers(): Promise<string[]> {
        const users = await this.db.query.userProfiles.findMany({
            columns: { userId: true },
        });
        return users.map(u => u.userId);
    }
}