import { Module } from '@nestjs/common';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';
import { validateFileServiceEnv } from './config/env.validation';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { fileServiceSchema } from './database/schema';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateFileServiceEnv,
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: fileServiceSchema,
    }),
    UploadModule,
  ],
  controllers: [FileServiceController],
  providers: [FileServiceService],
})
export class FileServiceModule { }
