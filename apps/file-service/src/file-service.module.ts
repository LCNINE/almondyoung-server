import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateFileServiceEnv,
    }),
    ScheduleModule.forRoot(),
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
    DownloadModule,
    CleanupModule,
  ],
  controllers: [FileServiceController],
  providers: [FileServiceService],
})
export class FileServiceModule { }
