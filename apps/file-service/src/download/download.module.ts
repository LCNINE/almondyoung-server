import { Module } from '@nestjs/common';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { FileAccessModule } from '../access/file-access.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [FileAccessModule, StorageModule],
  controllers: [DownloadController],
  providers: [DownloadService],
})
export class DownloadModule {}
