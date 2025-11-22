import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { SharedModule } from '../shared/shared.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SharedModule, StorageModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule { }
