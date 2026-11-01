import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DbModule } from '@app/db';
import { AuthorizationModule, JwtAuthGuard, PermissionGuard, PermissionModule } from '@app/authorization';
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
import { TenancyModule } from '@app/tenancy';
import { FileRequestTenantInterceptor } from './tenancy/file-request-tenant.interceptor';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateFileServiceEnv,
      envFilePath: ['.env', 'apps/file-service/.env'], // root .env 먼저 읽기
    }),
    // 테넌트 목록·전환 모드. 틀리면 여기서 기동 거부 (@app/tenancy).
    TenancyModule,
    AuthorizationModule.forAuthOnly(),
    PermissionModule.forRoot({ service: 'file-service', tenancy: 'per-token' }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: fileServiceSchema,
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
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). 인증 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 요청 테넌트 문 — 가드가 모두 끝난 뒤 토큰·헤더로 테넌트를 정한다. 맥락 없는 요청은 ② 에서 403(공개 읽기 제외).
    { provide: APP_INTERCEPTOR, useClass: FileRequestTenantInterceptor },
  ],
})
export class FileServiceModule {}
