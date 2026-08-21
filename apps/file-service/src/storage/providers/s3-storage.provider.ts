import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageUploadPort,
  StorageDeletePort,
  StorageSignedUrlPort,
  StorageDirectUploadPort,
  UploadRequest,
  UploadResult,
  DeleteRequest,
  SignedUrlRequest,
  SignedUrlResult,
  DirectUploadRequest,
  DirectUploadResult,
  HeadObjectRequest,
  HeadObjectResult,
  StorageProviderType,
  StorageError,
} from '../storage-provider.interface';

@Injectable()
export class S3StorageProvider
  implements StorageUploadPort, StorageDeletePort, StorageSignedUrlPort, StorageDirectUploadPort
{
  private readonly logger = new Logger(S3StorageProvider.name);
  private s3Client: S3Client;
  private presignClient: S3Client;
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

    const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;

    this.s3Client = new S3Client({ region: this.region, credentials });

    // presign 전용 클라이언트. 기본값(WHEN_SUPPORTED)이면 SDK 가 빈 body 기준
    // x-amz-checksum-crc32 를 서명된 쿼리에 넣어, 브라우저가 실제 본문을 PUT 하는
    // 순간 전부 checksum 불일치로 거부된다. 서버가 직접 쏘는 업로드/다운로드 동작을
    // 건드리지 않도록 공용 클라이언트와 분리한다.
    this.presignClient = new S3Client({
      region: this.region,
      credentials,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

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

  async createDirectUpload(request: DirectUploadRequest): Promise<DirectUploadResult> {
    try {
      const bucket = this.getBucket(request.isPublic);

      // ACL 은 presigner 가 서명된 쿼리 파라미터(x-amz-acl)로 옮기므로 브라우저가
      // 따로 헤더를 실을 필요가 없고, 위조도 안 된다. 이게 없으면 public 버킷 객체가
      // 직링크로 403 이 난다(프록시 업로드와 동일 정책). ContentType 은 서명에 들어가지
      // 않는다(SignedHeaders=host) — 저장될 객체 메타데이터용으로 헤더에 실어 보내고,
      // 신고 타입과 실제 객체의 대조는 confirm 의 HEAD 가 한다.
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: request.key,
        ContentType: request.contentType,
        ...(request.isPublic ? { ACL: 'public-read' as const } : {}),
      });

      const uploadUrl = await getSignedUrl(this.presignClient, command, {
        expiresIn: request.expiresIn,
      });

      const headers: Record<string, string> = {
        'Content-Type': request.contentType,
      };

      return {
        provider: StorageProviderType.S3,
        uploadUrl,
        headers,
        fileUrl: this.buildUrl(request.key, request.isPublic),
        expiresAt: new Date(Date.now() + request.expiresIn * 1000),
      };
    } catch (error) {
      this.logger.error(`S3 direct upload URL generation failed: ${error.message}`);
      throw new StorageError('S3_SIGNED_URL_FAILED', error.message);
    }
  }

  async headObject(request: HeadObjectRequest): Promise<HeadObjectResult | null> {
    const bucket = this.getBucket(request.isPublic ?? false);
    try {
      const response = await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: request.key }));
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType,
      };
    } catch (error) {
      // 미존재는 정상 흐름(업로드 전 confirm) — 에러로 던지지 않는다
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      this.logger.error(`S3 head object failed: ${error.message}`);
      throw new StorageError('S3_HEAD_FAILED', error.message);
    }
  }
}
