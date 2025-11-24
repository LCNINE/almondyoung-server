import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '@app/db';
import { AuthorizationModule, authorizationSchema, ScopeGuard, JwtAuthGuard } from '@app/authorization';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';
import { validateFileServiceEnv } from './config/env.validation';
import { fileServiceSchema } from './database/schema';
import { SharedModule } from './shared/shared.module';
import { StorageModule } from './storage/storage.module';
import { UploadModule } from './upload/upload.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { DownloadModule } from './download/download.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { FILE_SERVICE_SCOPES } from './auth/file-service.scopes';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateFileServiceEnv,
      envFilePath: ['.env', 'apps/file-service/.env'], // root .env 먼저 읽기
    }),
    ScheduleModule.forRoot(),
    AuthorizationModule.forRoot({
      microserviceName: 'file-service',
      scopes: FILE_SERVICE_SCOPES,
    }),
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
    DownloadModule,
    CleanupModule,
  ],
  controllers: [FileServiceController],
  providers: [
    FileServiceService,
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
export class FileServiceModule { }
