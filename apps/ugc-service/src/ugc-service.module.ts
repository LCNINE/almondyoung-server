import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { AuthorizationModule, authorizationSchema, JwtAuthGuard, ScopeGuard } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { UgcServiceController } from './ugc-service.controller';
import { UgcServiceService } from './ugc-service.service';
import { ReviewsModule } from './reviews/reviews.module';
import { QnaModule } from './qna/qna.module';
import { ugcServiceSchema } from './db/schema';

const combinedSchema = { ...ugcServiceSchema, ...authorizationSchema };

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/ugc-service/.env'],
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'ugc-service',
      scopes: [
        { key: 'admin:ugc:read', category: 'admin', description: '관리자 - UGC 조회 (리뷰, Q&A 목록 조회)' },
        { key: 'admin:ugc:modify', category: 'admin', description: '관리자 - UGC 관리 (리뷰 댓글, Q&A 답변)' },
      ],
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    ScheduleModule.forRoot(),
    ReviewsModule,
    QnaModule,
  ],
  controllers: [UgcServiceController],
  providers: [
    UgcServiceService,
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
export class UgcServiceModule {}
