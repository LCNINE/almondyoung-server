// apps/notification/src/shared/services/user-sync.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { userProfiles, NewUserProfile, UserProfile } from '../../../database/schemas/notification-schema';
import { MembershipType, Channel } from '../enums';

@Injectable()
export class UserSyncService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async syncUser(userData: {
        userId: string;
        email?: string;
        phoneNumber?: string;
        pushToken?: string;
        membershipType?: string;
        shopCategories?: string[];
        metadata?: any;
    }) {
        const existing = await this.db.query.userProfiles.findFirst({
            where: eq(userProfiles.userId, userData.userId)
        });

        if (existing) {
            await this.db
                .update(userProfiles)
                .set({
                    ...userData,
                    membershipType: userData.membershipType as any,
                    syncedAt: new Date(),
                })
                .where(eq(userProfiles.userId, userData.userId));
        } else {
            await this.db
                .insert(userProfiles)
                .values({
                    ...userData,
                    membershipType: (userData.membershipType || MembershipType.GENERAL) as any,
                });
        }
    }

    async getUsersByFilter(filter: {
        membershipTypes?: string[];
        shopCategories?: string[];
    }): Promise<string[]> {
        const conditions: any[] = [];

        if (Array.isArray(filter.membershipTypes) && filter.membershipTypes.length > 0) {
            const validMembershipTypes = filter.membershipTypes.filter(
                (type): type is 'general' | 'premium' =>
                    type === MembershipType.GENERAL || type === MembershipType.PREMIUM
            );
            if (validMembershipTypes.length > 0) {
                conditions.push(
                    inArray(userProfiles.membershipType, validMembershipTypes)
                );
            }
        }

        if (Array.isArray(filter.shopCategories) && filter.shopCategories.length > 0) {
            conditions.push(
                sql`${userProfiles.shopCategories} ?| ARRAY[${sql.join(filter.shopCategories, sql`, `)}]`
            );
        }

        const users = await this.db.query.userProfiles.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            columns: {
                userId: true,
            },
        });

        return users.map(u => u.userId);
    }

    async getUserProfile(userId: string): Promise<UserProfile | undefined> {
        return this.db.query.userProfiles.findFirst({
            where: eq(userProfiles.userId, userId)
        });
    }

    // 배치 조회 메서드 추가
    async getUserProfiles(userIds: string[]): Promise<Map<string, UserProfile>> {
        const profiles = await this.db.query.userProfiles.findMany({
            where: inArray(userProfiles.userId, userIds)
        });

        return new Map(profiles.map(p => [p.userId, p]));
    }

    async getUserContacts(userIds: string[], channel: string) {
        const users = await this.db.query.userProfiles.findMany({
            where: inArray(userProfiles.userId, userIds)
        });

        return users.map(user => ({
            userId: user.userId,
            contact: this.getContactForChannel(user, channel as Channel),
        })).filter(u => u.contact);
    }

    private getContactForChannel(user: UserProfile, channel: Channel): string | null {
        switch (channel) {
            case 'EMAIL':
                return user.email || null;
            case 'SMS':
            case 'KAKAO':
                return user.phoneNumber || null;
            case 'PUSH':
                return user.pushToken || null;
            default:
                return null;
        }
    }
}
