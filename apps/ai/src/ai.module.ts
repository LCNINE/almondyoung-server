import { AuthorizationModule, authorizationSchema, JwtAuthGuard, ScopeGuard } from '@app/authorization';
import { DbModule } from '@app/db';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AiController } from './ai.controller';
import { AssistantModule } from './assistant/assistant.module';
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
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    AssistantModule,
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
