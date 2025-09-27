import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { notificationTables } from '../database/schemas/notification-schema';

// Core modules
import { SharedModule } from './shared/shared.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { ProviderModule } from './provider/provider.module';
import { TemplateModule } from './template/template.module';
import { BulkModule } from './bulk/bulk.module';

// Event handlers
import { UserServiceEventsHandler } from './event-handlers/services/user-service-events.handler';
import { MedusaEventsHandler } from './event-handlers/services/medusa-events.handler';
import { WalletEventsHandler } from './event-handlers/services/wallet-events.handler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    EventsModule,
    SharedModule,
    DispatcherModule,
    ProviderModule,
    TemplateModule,
    BulkModule,
  ],
  controllers: [
    UserServiceEventsHandler,
    MedusaEventsHandler,
    WalletEventsHandler,
  ],
  providers: [
    UserServiceEventsHandler,
    MedusaEventsHandler,
    WalletEventsHandler,
  ],
})
export class NotificationModule {}
