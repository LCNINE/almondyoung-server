import { Injectable } from '@nestjs/common';
import { StorageProviderRegistry } from './storage-provider.registry';
import {
  UploadRequest,
  UploadResult,
  DeleteRequest,
  SignedUrlRequest,
  SignedUrlResult,
} from './storage-provider.interface';

@Injectable()
export class StorageService {
  constructor(private readonly registry: StorageProviderRegistry) {}

  async upload(request: UploadRequest): Promise<UploadResult> {
    const provider = this.registry.getActive();
    return provider.upload.upload(request);
  }

  async delete(request: DeleteRequest): Promise<void> {
    const provider = this.registry.getActive();
    return provider.delete.delete(request);
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    const provider = this.registry.getActive();
    return provider.signedUrl.getSignedUrl(request);
  }
}

