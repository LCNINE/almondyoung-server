// apps/notification/src/shared/services/user-notification.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import {
    userNotificationSettings,
    UserNotificationSetting,
    NewUserNotificationSetting,
    PushSettings,
    GeneralSettings,
} from '../../../database/schemas/notification-schema';
import { Language } from '../enums';
import { CreateUserNotificationSettingsDto, UpdateUserNotificationSettingsDto } from '../dto/user-notification-settings.dto';

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

    // 배치 조회 메서드
    async getUsersNotificationSettings(userIds: string[]): Promise<Map<string, UserNotificationSetting>> {
        const settings = await this.db.query.userNotificationSettings.findMany({
            where: inArray(userNotificationSettings.userId, userIds)
        });

        return new Map(settings.map(s => [s.userId, s]));
    }

    async createNotificationSettings(
        userId: string,
        dto: CreateUserNotificationSettingsDto,
    ): Promise<UserNotificationSetting> {
        const newSetting: NewUserNotificationSetting = {
            userId,
            isMarketingEnabled: dto.isMarketingEnabled,
            preferredLanguage: dto.preferredLanguage as any,
            pushSettings: dto.pushSettings,
            settings: dto.settings,
        };

        const [created] = await this.db
            .insert(userNotificationSettings)
            .values(newSetting)
            .returning();

        return created;
    }

    async updateNotificationSettings(
        userId: string,
        dto: UpdateUserNotificationSettingsDto,
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
                isMarketingEnabled: dto.isMarketingEnabled ?? false, // 기본값 false
                preferredLanguage: dto.preferredLanguage ?? Language.KO as any,
                pushSettings: dto.pushSettings,
                settings: dto.settings,
            };

            const [created] = await this.db
                .insert(userNotificationSettings)
                .values(newSetting)
                .returning();

            return created;
        }
    }

    /**
     * 마케팅 수신 동의 확인
     * @param userId 사용자 ID
     * @returns 마케팅 수신 동의 여부 (설정이 없으면 false)
     */
    async isMarketingEnabled(userId: string): Promise<boolean> {
        const settings = await this.getUserNotificationSettings(userId);
        return settings?.isMarketingEnabled ?? false; // 기본값 false (동의하지 않음)
    }

    /**
     * 마케팅 수신 동의 상태 변경
     * @param userId 사용자 ID
     * @param enabled 동의 여부
     */
    async setMarketingConsent(userId: string, enabled: boolean): Promise<UserNotificationSetting> {
        return this.updateNotificationSettings(userId, {
            isMarketingEnabled: enabled,
        });
    }

    /**
     * 여러 사용자의 마케팅 수신 동의 상태 확인
     * @param userIds 사용자 ID 목록
     * @returns 마케팅 수신 동의한 사용자 ID 목록
     */
    async getMarketingEnabledUsers(userIds: string[]): Promise<string[]> {
        const settings = await this.db.query.userNotificationSettings.findMany({
            where: inArray(userNotificationSettings.userId, userIds),
            columns: { userId: true, isMarketingEnabled: true },
        });

        return settings
            .filter(s => s.isMarketingEnabled)
            .map(s => s.userId);
    }

    /**
     * 사용자의 언어 설정 조회
     * @param userId 사용자 ID
     * @returns 선호 언어 (기본값: ko)
     */
    async getUserLanguage(userId: string): Promise<Language> {
        const settings = await this.getUserNotificationSettings(userId);
        return (settings?.preferredLanguage as Language) ?? Language.KO;
    }

    /**
     * 푸시 설정 업데이트
     * @param userId 사용자 ID
     * @param pushSettings 푸시 설정
     */
    async updatePushSettings(userId: string, pushSettings: PushSettings): Promise<UserNotificationSetting> {
        return this.updateNotificationSettings(userId, { pushSettings });
    }

    /**
     * 방해금지 시간 확인
     * @param userId 사용자 ID
     * @returns 현재 방해금지 시간인지 여부
     */
    async isQuietHours(userId: string): Promise<boolean> {
        const settings = await this.getUserNotificationSettings(userId);
        if (!settings?.pushSettings?.quietHours?.enabled) {
            return false;
        }

        const quietHours = settings.pushSettings.quietHours;
        if (!quietHours.startTime || !quietHours.endTime) {
            return false;
        }

        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // 시작 시간과 종료 시간 비교
        if (quietHours.startTime <= quietHours.endTime) {
            // 같은 날 (예: 09:00 ~ 18:00)
            return currentTime >= quietHours.startTime && currentTime <= quietHours.endTime;
        } else {
            // 다음 날로 넘어가는 경우 (예: 22:00 ~ 08:00)
            return currentTime >= quietHours.startTime || currentTime <= quietHours.endTime;
        }
    }
}
