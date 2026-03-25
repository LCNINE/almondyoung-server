import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3StorageProvider } from './providers/s3-storage.provider';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { StorageProviderRegistry } from './storage-provider.registry';
import { StorageService } from './storage.service';
import { PathBuilderService } from './path-builder.service';

@Module({
  imports: [ConfigModule],
  providers: [S3StorageProvider, LocalStorageProvider, StorageProviderRegistry, StorageService, PathBuilderService],
  exports: [StorageService, PathBuilderService],
})
export class StorageModule {}
