import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DbModule } from '@app/db';
import {
  AuthorizationModule,
  authorizationSchema,
  AuthzObserverGuard,
  AuthzShadowInterceptor,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
} from '@app/authorization';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';
import { validateFileServiceEnv } from './config/env.validation';
import { fileServiceSchema } from './database/schema';
import { SharedModule } from './shared/shared.module';
import { StorageModule } from './storage/storage.module';
import { UploadModule } from './upload/upload.module';
import { InternalFilesModule } from './internal/internal-files.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { DownloadModule } from './download/download.module';
import { LegacyDelegationInterceptor } from './access/legacy-delegation.interceptor';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateFileServiceEnv,
      envFilePath: ['.env', 'apps/file-service/.env'], // root .env 먼저 읽기
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'file-service',
      scopes: [],
    }),
    PermissionModule.forRoot({ service: 'file-service' }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: { ...fileServiceSchema, ...authorizationSchema },
    }),
    SharedModule,
    StorageModule,
    UploadModule,
    LifecycleModule,
    InternalFilesModule,
    DownloadModule,
  ],
  controllers: [FileServiceController],
  providers: [
    FileServiceService,
    // 그림자 판정 관찰 — 반드시 맨 앞(뒤 가드가 거부한 요청도 봐야 한다). 결과에 관여하지 않는다.
    { provide: APP_GUARD, useClass: AuthzObserverGuard },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). 인증 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthzShadowInterceptor },
    // 옛 표기 위임 토큰 사용을 센다 — 옛 표기를 거절하기 전에 0건을 확인하는 근거.
    { provide: APP_INTERCEPTOR, useClass: LegacyDelegationInterceptor },
  ],
})
export class FileServiceModule {}
