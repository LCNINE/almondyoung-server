import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from '@app/events';
import { validateOutboxDemoEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { TestModule } from './test/test.module';
import { TEST_STREAM } from './test/test-stream.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateOutboxDemoEnv,
      envFilePath: ['apps/outbox-demo/.env.local', 'apps/outbox-demo/.env'],
    }),
    ScheduleModule.forRoot(),
    EventsModule.forRoot({
      streams: [TEST_STREAM],
      serviceName: 'outbox-demo',
    }),
    DatabaseModule,
    TestModule,
  ],
})
export class AppModule {}
