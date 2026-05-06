import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { notificationTables, fcmTokens } from '../../../database/schemas/notification-schema';
import { eq, and, sql } from 'drizzle-orm';
import { RegisterFcmTokenDto } from '../dto/register-token.dto';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async registerToken(userId: string, dto: RegisterFcmTokenDto): Promise<void> {
    const values = {
      userId,
      token: dto.token,
      platform: dto.platform,
      deviceId: dto.deviceId ?? null,
      deviceModel: dto.deviceModel ?? null,
      deviceName: dto.deviceName ?? null,
      isActive: true,
      lastUsedAt: new Date(),
    };

    const updateSet = {
      token: dto.token,
      platform: dto.platform,
      // excluded.* = proposed new value; fcmTokens.* = existing — prefer new if non-null
      deviceModel: sql`COALESCE(excluded.device_model, ${fcmTokens.deviceModel})`,
      deviceName: sql`COALESCE(excluded.device_name, ${fcmTokens.deviceName})`,
      isActive: true,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    };

    if (dto.deviceId) {
      await this.db
        .insert(fcmTokens)
        .values(values)
        .onConflictDoUpdate({ target: [fcmTokens.userId, fcmTokens.deviceId], set: updateSet });
    } else {
      await this.db
        .insert(fcmTokens)
        .values(values)
        .onConflictDoUpdate({ target: fcmTokens.token, set: updateSet });
    }

    this.logger.log('FCM token registered', { userId, platform: dto.platform });
  }

  async deactivateToken(userId: string, token: string): Promise<void> {
    await this.db
      .update(fcmTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(fcmTokens.userId, userId), eq(fcmTokens.token, token)));

    this.logger.log('FCM token deactivated', { userId });
  }

  async deactivateAllUserTokens(userId: string): Promise<void> {
    await this.db
      .update(fcmTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(fcmTokens.userId, userId), eq(fcmTokens.isActive, true)));

    this.logger.log('All FCM tokens deactivated for user', { userId });
  }
}
