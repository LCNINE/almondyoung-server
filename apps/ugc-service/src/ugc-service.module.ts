import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { CronOnceModule } from '@app/cron-once';
import { DbModule } from '@app/db';
import { AuthorizationModule, authorizationSchema, JwtAuthGuard, ScopeGuard } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { UgcServiceController } from './ugc-service.controller';
import { UgcServiceService } from './ugc-service.service';
import { ReviewsModule } from './reviews/reviews.module';
import { QnaModule } from './qna/qna.module';
import { ShopListingsModule } from './shop-listings/shop-listings.module';
import { LogoContestModule } from './logo-contest/logo-contest.module';
import { ugcServiceSchema } from './db/schema';
import { UGC_ROLE_MAPPINGS, UGC_SCOPES } from './shared/auth/ugc-scopes';

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
      scopes: UGC_SCOPES,
      roleMappings: UGC_ROLE_MAPPINGS,
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    SCHEDULE_ROOT,
    CronOnceModule,
    ReviewsModule,
    QnaModule,
    ShopListingsModule,
    LogoContestModule,
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
