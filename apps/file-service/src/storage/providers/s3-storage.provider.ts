import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
export class S3StorageProvider implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort {
  private readonly logger = new Logger(S3StorageProvider.name);
  private s3Client: S3Client;
  private publicBucket: string;
  private privateBucket: string;
  private region: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const storageProvider = this.configService.get<string>('STORAGE_PROVIDER', 'S3');
    if (storageProvider === 'S3') {
      this.initializeS3Client();
    }
  }

  private initializeS3Client(): void {
    this.region = this.configService.getOrThrow<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    this.publicBucket = this.configService.getOrThrow<string>('AWS_S3_PUBLIC_BUCKET');
    this.privateBucket = this.configService.getOrThrow<string>('AWS_S3_PRIVATE_BUCKET');

    const credentials =
      accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;

    this.s3Client = new S3Client({ region: this.region, credentials });

    this.logger.log('S3 Storage Provider initialized');
  }

  private getBucket(isPublic: boolean): string {
    return isPublic ? this.publicBucket : this.privateBucket;
  }

  private buildUrl(key: string, isPublic: boolean): string {
    const bucket = this.getBucket(isPublic);
    return `https://${bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    try {
      const isPublic = request.isPublic ?? false;
      const bucket = this.getBucket(isPublic);

      const commandParams: any = {
        Bucket: bucket,
        Key: request.key,
        Body: request.buffer,
        ContentType: request.contentType,
        Metadata: request.metadata,
      };

      if (isPublic) {
        commandParams.ACL = 'public-read';
      }

      const command = new PutObjectCommand(commandParams);
      const response = await this.s3Client.send(command);

      const url = this.buildUrl(request.key, isPublic);

      this.logger.log(`File uploaded to S3 (${isPublic ? 'public' : 'private'}): ${request.key}`);

      return {
        success: true,
        key: request.key,
        url,
        provider: StorageProviderType.S3,
        isPublic,
        metadata: {
          etag: response.ETag,
          versionId: response.VersionId,
          bucket,
        },
      };
    } catch (error) {
      this.logger.error(`S3 upload failed: ${error.message}`);
      throw new StorageError('S3_UPLOAD_FAILED', error.message);
    }
  }

  async delete(request: DeleteRequest): Promise<void> {
    try {
      const isPublic = request.isPublic ?? false;
      const bucket = this.getBucket(isPublic);

      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: request.key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted from S3 (${isPublic ? 'public' : 'private'}): ${request.key}`);
    } catch (error) {
      this.logger.error(`S3 delete failed: ${error.message}`);
      throw new StorageError('S3_DELETE_FAILED', error.message);
    }
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    try {
      const isPublic = request.isPublic ?? false;
      const bucket = this.getBucket(isPublic);

      const command =
        request.operation === 'put'
          ? new PutObjectCommand({
              Bucket: bucket,
              Key: request.key,
            })
          : new GetObjectCommand({
              Bucket: bucket,
              Key: request.key,
              ...(request.responseContentDisposition
                ? { ResponseContentDisposition: request.responseContentDisposition }
                : {}),
            });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: request.expiresIn,
      });

      const expiresAt = new Date(Date.now() + request.expiresIn * 1000);

      return { signedUrl, expiresAt };
    } catch (error) {
      this.logger.error(`S3 signed URL generation failed: ${error.message}`);
      throw new StorageError('S3_SIGNED_URL_FAILED', error.message);
    }
  }
}
