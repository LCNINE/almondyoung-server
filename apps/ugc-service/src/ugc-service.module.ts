import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { CronOnceModule } from '@app/cron-once';
import { DbModule } from '@app/db';
import {
  AuthorizationModule,
  authorizationSchema,
  AuthzObserverGuard,
  AuthzShadowInterceptor,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
  ScopeGuard,
} from '@app/authorization';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { UgcServiceController } from './ugc-service.controller';
import { UgcServiceService } from './ugc-service.service';
import { ReviewsModule } from './reviews/reviews.module';
import { QnaModule } from './qna/qna.module';
import { ShopListingsModule } from './shop-listings/shop-listings.module';
import { LogoContestModule } from './logo-contest/logo-contest.module';
import { AlmondTemplateModule } from './almond-template/almond-template.module';
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
    PermissionModule.forRoot({ service: 'ugc-service' }),
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
    AlmondTemplateModule,
  ],
  controllers: [UgcServiceController],
  providers: [
    UgcServiceService,
    // 그림자 판정 관찰 — 반드시 맨 앞(뒤 가드가 거부한 요청도 봐야 한다). 결과에 관여하지 않는다.
    { provide: APP_GUARD, useClass: AuthzObserverGuard },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ScopeGuard,
    },
    // 권한 강제 — AUTHZ_ENFORCE=true 일 때만 일한다(기본 꺼짐). 기존 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthzShadowInterceptor },
  ],
})
export class UgcServiceModule {}
