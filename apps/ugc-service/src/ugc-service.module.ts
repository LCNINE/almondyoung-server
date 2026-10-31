import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { CronOnceModule } from '@app/cron-once';
import { DbModule } from '@app/db';
import {
  AuthorizationModule,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
  piiMaskingProviders,
} from '@app/authorization';
import { OutboxPiiAccessRecorder } from '@app/authorization/recorders/outbox-pii-access.recorder';
import { APP_GUARD } from '@nestjs/core';
import { UgcServiceController } from './ugc-service.controller';
import { UgcServiceService } from './ugc-service.service';
import { ReviewsModule } from './reviews/reviews.module';
import { QnaModule } from './qna/qna.module';
import { PurchaseSatisfactionModule } from './purchase-satisfaction/purchase-satisfaction.module';
import { ShopListingsModule } from './shop-listings/shop-listings.module';
import { LogoContestModule } from './logo-contest/logo-contest.module';
import { AlmondTemplateModule } from './almond-template/almond-template.module';
import { ugcServiceSchema } from './db/schema';
import { TenancyModule } from '@app/tenancy';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/ugc-service/.env'],
    }),
    // 테넌트 목록·전환 모드. 틀리면 여기서 기동 거부 (@app/tenancy).
    TenancyModule,
    AuthorizationModule.forAuthOnly(),
    PermissionModule.forRoot({ service: 'ugc-service', tenancy: 'served-tenant' }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: ugcServiceSchema,
    }),
    SCHEDULE_ROOT,
    CronOnceModule,
    ReviewsModule,
    QnaModule,
    ShopListingsModule,
    PurchaseSatisfactionModule,
    LogoContestModule,
    AlmondTemplateModule,
  ],
  controllers: [UgcServiceController],
  providers: [
    UgcServiceService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). 인증 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 개인정보 표시 제한 — 다른 응답 인터셉터보다 바깥에서 최종 본문을 본다.
    ...piiMaskingProviders({ service: 'ugc-service', recorder: OutboxPiiAccessRecorder }),
  ],
})
export class UgcServiceModule {}
