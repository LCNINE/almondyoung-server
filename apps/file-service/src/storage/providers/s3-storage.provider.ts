import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
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
export class S3StorageProvider
  implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort {
  private readonly logger = new Logger(S3StorageProvider.name);
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor(private readonly configService: ConfigService) { }

  onModuleInit() {
    this.initializeS3Client();
  }

  private initializeS3Client(): void {
    this.region = this.configService.getOrThrow<string>('AWS_REGION');
    const accessKeyId = this.configService.getOrThrow<string>(
      'AWS_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.getOrThrow<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    this.bucketName = this.configService.getOrThrow<string>('AWS_S3_BUCKET');

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.logger.log('S3 Storage Provider initialized');
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: request.key,
        Body: request.buffer,
        ContentType: request.contentType,
        Metadata: request.metadata,
      });

      const response = await this.s3Client.send(command);

      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${request.key}`;

      this.logger.log(`File uploaded to S3: ${request.key}`);

      return {
        success: true,
        key: request.key,
        url,
        provider: StorageProviderType.S3,
        metadata: {
          etag: response.ETag,
          versionId: response.VersionId,
        },
      };
    } catch (error) {
      this.logger.error(`S3 upload failed: ${error.message}`);
      throw new StorageError('S3_UPLOAD_FAILED', error.message);
    }
  }

  async delete(request: DeleteRequest): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: request.key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted from S3: ${request.key}`);
    } catch (error) {
      this.logger.error(`S3 delete failed: ${error.message}`);
      throw new StorageError('S3_DELETE_FAILED', error.message);
    }
  }

  async getSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
    try {
      const command =
        request.operation === 'put'
          ? new PutObjectCommand({
            Bucket: this.bucketName,
            Key: request.key,
          })
          : new GetObjectCommand({
            Bucket: this.bucketName,
            Key: request.key,
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

