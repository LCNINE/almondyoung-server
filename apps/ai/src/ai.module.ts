import {
  AuthorizationModule,
  AuthzObserverGuard,
  AuthzShadowInterceptor,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
} from '@app/authorization';
import { CronOnceModule } from '@app/cron-once';
import { DbModule } from '@app/db';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { Module } from '@nestjs/common';
import { AttendanceAiModule } from './attendance/attendance.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AiController } from './ai.controller';
import { AssistantModule } from './assistant/assistant.module';
import { FilesModule } from './files/files.module';
import { aiSchema } from './db/schema';
import { ProductDescriptionModule } from './product-description/product-description.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/ai/.env'],
    }),
    AuthorizationModule.forAuthOnly(),
    PermissionModule.forRoot({ service: 'ai' }),
    // 이 둘이 빠지면 @CronOnce 는 조용히 안 돈다.
    SCHEDULE_ROOT,
    CronOnceModule,
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: aiSchema,
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
    AttendanceAiModule,
  ],
  controllers: [AiController],
  providers: [
    // 그림자 판정 관찰 — 반드시 맨 앞(뒤 가드가 거부한 요청도 봐야 한다). 결과에 관여하지 않는다.
    { provide: APP_GUARD, useClass: AuthzObserverGuard },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). 인증 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthzShadowInterceptor },
  ],
})
export class AiModule {}
