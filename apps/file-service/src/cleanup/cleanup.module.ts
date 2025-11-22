import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { SharedModule } from '../shared/shared.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SharedModule, StorageModule],
  providers: [CleanupService],
})
export class CleanupModule {}

