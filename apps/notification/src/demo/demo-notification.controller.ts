import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService, InjectTypedDb } from '@app/db';
import { desc } from 'drizzle-orm';
import { notifications, notificationTables } from '../../database/schemas/notification-schema';

/** Uses the same persistent delivery records as the direct dispatcher (no Redis in demo). */
@Controller('demo')
export class DemoNotificationController {
  constructor(
    private readonly config: ConfigService,
    @InjectTypedDb<typeof notificationTables>() private readonly database: DbService<typeof notificationTables>,
  ) {}

  @Get('notifications')
  async list() {
    if (
      this.config.get('APP_STAGE') !== 'demo' ||
      this.config.get('DEMO_CONSOLE_ENABLED') !== 'true' ||
      this.config.get('EXTERNAL_INTEGRATIONS_MODE') !== 'mock'
    ) {
      throw new NotFoundException();
    }
    const rows = await this.database.db
      .select({
        logId: notifications.notificationId,
        channel: notifications.channel,
        status: notifications.status,
        createdAt: notifications.createdAt,
        metadata: notifications.metadata,
      })
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(20);
    return {
      logs: rows.map(({ metadata, ...row }) => ({
        ...row,
        result:
          (metadata as { providerResponse?: { recipient?: string; subject?: string; content?: string } } | null)
            ?.providerResponse ?? null,
      })),
    };
  }
}
