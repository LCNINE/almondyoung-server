import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageProviderHandle,
  StorageProviderType,
} from './storage-provider.interface';
import { S3StorageProvider } from './providers/s3-storage.provider';
import { LocalStorageProvider } from './providers/local-storage.provider';

@Injectable()
export class StorageProviderRegistry {
  private readonly activeProvider: StorageProviderType;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Provider: S3StorageProvider,
    private readonly localProvider: LocalStorageProvider,
  ) {
    this.activeProvider = this.configService.get<StorageProviderType>(
      'STORAGE_PROVIDER',
      StorageProviderType.S3,
    );
  }

  getActive(): StorageProviderHandle {
    return this.get(this.activeProvider);
  }

  get(provider: StorageProviderType): StorageProviderHandle {
    switch (provider) {
      case StorageProviderType.S3:
        return {
          id: StorageProviderType.S3,
          upload: this.s3Provider,
          delete: this.s3Provider,
          signedUrl: this.s3Provider,
          list: null,
          copy: null,
        };

      case StorageProviderType.LOCAL:
        return {
          id: StorageProviderType.LOCAL,
          upload: this.localProvider,
          delete: this.localProvider,
          signedUrl: this.localProvider,
          list: null,
          copy: null,
        };

      default:
        throw new Error(`Unknown storage provider: ${provider}`);
    }
  }
}

