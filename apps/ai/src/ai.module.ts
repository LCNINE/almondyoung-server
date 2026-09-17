import { AuthorizationModule, authorizationSchema, JwtAuthGuard, ScopeGuard } from '@app/authorization';
import { CronOnceModule } from '@app/cron-once';
import { DbModule } from '@app/db';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AiController } from './ai.controller';
import { AssistantModule } from './assistant/assistant.module';
import { FilesModule } from './files/files.module';
import { aiSchema } from './db/schema';
import { AI_ROLE_MAPPINGS, AI_SCOPES } from './platform/auth/ai-scopes';
import { ProductDescriptionModule } from './product-description/product-description.module';

const combinedSchema = { ...aiSchema, ...authorizationSchema };

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/ai/.env'],
    }),
    // 스코프와 역할 매핑은 이 앱이 자기 DB(auth 스키마)에 시드한다 — ScopeGuard 가
    // IdP 가 아니라 이 DB 를 조회하기 때문이다
    AuthorizationModule.forRoot({
      microserviceName: 'ai',
      scopes: AI_SCOPES,
      roleMappings: AI_ROLE_MAPPINGS,
    }),
    // 이 둘이 빠지면 @CronOnce 는 조용히 안 돈다.
    SCHEDULE_ROOT,
    CronOnceModule,
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    // 소비 전용(`publishes` 없음). 브로커 없는 로컬에서 부팅이 죽지 않게 조건부다 —
    // main.ts 의 startConsumer 와 짝이다.
    ...(process.env.KAFKA_BROKERS
      ? [
          EventsModule.forApp({
            kafka: createKafkaConfigFromEnv()!,
            serviceName: 'ai',
            policy: { validateOnConsume: true },
          }),
        ]
      : []),
    AssistantModule,
    FilesModule,
    ProductDescriptionModule,
  ],
  controllers: [AiController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ScopeGuard,
    },
  ],
})
export class AiModule {}
