import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  StorageUploadPort,
  StorageDeletePort,
  StorageSignedUrlPort,
  UploadRequest,
  UploadResult,
  DeleteRequest,
  SignedUrlRequest,
  SignedUrlResult,
  StorageProviderType,
  StorageError,
} from '../storage-provider.interface';
import { localUploadsDir } from '../local-storage.path';

@Injectable()
export class LocalStorageProvider implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly baseDir: string;
  private readonly port: string;

  constructor(private readonly configService: ConfigService) {
    this.port = this.configService.get<string>('PORT', '3000');
    this.baseDir = localUploadsDir(this.configService);
  }

  /**
   * 이 URL 을 실제로 받아내는 라우트는 `LocalFileController` 다(`GET /files/local/*`).
   * 둘 중 하나만 고치면 업로드는 되는데 되읽기가 404 가 되므로 같이 본다.
   */
  private buildUrl(key: string, responseContentDisposition?: string): string {
    const base = `http://localhost:${this.port}/files/local/${key}`;
    // S3 의 ResponseContentDisposition 대응물. 이게 없으면 워크북이 원본 파일명 대신
    // UUID 로 저장돼 `download=true` 의 의미가 로컬에서만 사라진다.
    return responseContentDisposition
      ? `${base}?disposition=${encodeURIComponent(responseContentDisposition)}`
      : base;
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    try {
      const isPublic = request.isPublic ?? false;
      const filePath = path.join(this.baseDir, request.key);
      const dir = path.dirname(filePath);

      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, request.buffer);

      const url = this.buildUrl(request.key);

      this.logger.log(`File uploaded to local (${isPublic ? 'public' : 'private'}): ${request.key}`);

      return {
        success: true,
        key: request.key,
        url,
        provider: StorageProviderType.LOCAL,
        isPublic,
      };
    } catch (error) {
      this.logger.error(`Local upload failed: ${error.message}`);
      throw new StorageError('LOCAL_UPLOAD_FAILED', error.message);
    }
  }

  async delete(request: DeleteRequest): Promise<void> {
    try {
      const filePath = path.join(this.baseDir, request.key);
      await fs.unlink(filePath);
      this.logger.log(`File deleted from local: ${request.key}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`Local delete failed: ${error.message}`);
        throw new StorageError('LOCAL_DELETE_FAILED', error.message);
      }
    }
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    const signedUrl = this.buildUrl(request.key, request.responseContentDisposition);
    const expiresAt = new Date(Date.now() + request.expiresIn * 1000);

    return { signedUrl, expiresAt };
  }
}
