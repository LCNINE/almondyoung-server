import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@app/authorization';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { SharedModule } from '../shared/shared.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuthorizationModule, SharedModule, StorageModule],
  controllers: [DownloadController],
  providers: [DownloadService],
})
export class DownloadModule {}
