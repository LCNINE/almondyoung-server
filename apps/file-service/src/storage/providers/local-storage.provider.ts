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

@Injectable()
export class LocalStorageProvider implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly baseDir = path.join(process.cwd(), 'uploads');
  private readonly port: string;

  constructor(private readonly configService: ConfigService) {
    this.port = this.configService.get<string>('PORT', '3000');
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    try {
      const isPublic = request.isPublic ?? false;
      const filePath = path.join(this.baseDir, request.key);
      const dir = path.dirname(filePath);

      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, request.buffer);

      const url = `http://localhost:${this.port}/files/local/${request.key}`;

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
    const signedUrl = `http://localhost:${this.port}/files/local/${request.key}`;
    const expiresAt = new Date(Date.now() + request.expiresIn * 1000);

    return { signedUrl, expiresAt };
  }
}
