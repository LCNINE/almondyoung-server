// apps/notification/src/shared/services/user-notification.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import {
    userNotificationSettings,
    UserNotificationSetting,
    NewUserNotificationSetting
} from '../../../database/schemas/notification-schema';
import { Language } from '../enums';

@Injectable()
export class UserNotificationService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async getUserNotificationSettings(userId: string): Promise<UserNotificationSetting | null> {
        const setting = await this.db.query.userNotificationSettings.findFirst({
            where: eq(userNotificationSettings.userId, userId)
        });

        return setting || null;
    }

    // 배치 조회 메서드 추가
    async getUsersNotificationSettings(userIds: string[]): Promise<Map<string, UserNotificationSetting>> {
        const settings = await this.db.query.userNotificationSettings.findMany({
            where: inArray(userNotificationSettings.userId, userIds)
        });

        return new Map(settings.map(s => [s.userId, s]));
    }

    async updateNotificationSettings(
        userId: string,
        dto: {
            isNotificationEnabled?: boolean;
            preferredLanguage?: Language;
            settings?: any;
        },
    ): Promise<UserNotificationSetting> {
        const existing = await this.getUserNotificationSettings(userId);

        if (existing) {
            const [updated] = await this.db
                .update(userNotificationSettings)
                .set({
                    ...dto,
                    updatedAt: new Date(),
                })
                .where(eq(userNotificationSettings.userId, userId))
                .returning();

            return updated;
        } else {
            const newSetting: NewUserNotificationSetting = {
                userId,
                isNotificationEnabled: dto.isNotificationEnabled ?? true,
                preferredLanguage: dto.preferredLanguage ?? Language.KO as any,
                settings: dto.settings,
            };

            const [created] = await this.db
                .insert(userNotificationSettings)
                .values(newSetting)
                .returning();

            return created;
        }
    }

    async isUserNotificationEnabled(userId: string): Promise<boolean> {
        const settings = await this.getUserNotificationSettings(userId);
        return settings?.isNotificationEnabled ?? true; // 기본값 true
    }
}