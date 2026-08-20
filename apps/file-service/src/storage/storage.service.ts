import { Injectable } from '@nestjs/common';
import { StorageProviderRegistry } from './storage-provider.registry';
import {
  UploadRequest,
  UploadResult,
  DeleteRequest,
  SignedUrlRequest,
  SignedUrlResult,
  StorageDirectUploadPort,
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

  /** 활성 프로바이더가 직접 업로드를 지원하지 않으면 null */
  getDirectUploadPort(): StorageDirectUploadPort | null {
    return this.registry.getActive().directUpload ?? null;
  }
}
