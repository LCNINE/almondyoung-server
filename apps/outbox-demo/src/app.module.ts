import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { validateOutboxDemoEnv } from './config/env.validation';
import { TestModule } from './test/test.module';
import { TEST_STREAM } from '@packages/event-contracts/streams/test.stream';
import { outboxDemoSchema } from '../database/schemas/schema';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateOutboxDemoEnv,
      envFilePath: ['apps/outbox-demo/.env.local', 'apps/outbox-demo/.env'],
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: outboxDemoSchema,
    }),
    EventsModule.forRoot({
      streams: [TEST_STREAM],
      serviceName: 'outbox-demo',
      enableOutbox: true,
      outbox: {
        dispatchIntervalMs: 5000,
        batchSize: 100,
        maxRetries: 5,
        cleanupDays: 7,
      },
    }),
    TestModule,
  ],
})
export class AppModule { }
