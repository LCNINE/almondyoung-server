import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import { S3_FOLDER_NAMES } from './constants';
import { ValidatedFile } from './interfaces/validated-file.interface';

@Injectable()
export class FileService implements OnModuleInit {
  private readonly logger = new Logger(FileService.name);
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeS3Client();
  }

  private initializeS3Client(): void {
    this.region = this.configService.getOrThrow<string>('AWS_REGION');
    const accessKeyId = this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.getOrThrow<string>('AWS_SECRET_ACCESS_KEY');
    this.bucketName = this.configService.getOrThrow<string>('AWS_S3_BUCKET');

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.logger.log('S3 Client initialized successfully');
  }

  async uploadFile(file: ValidatedFile, userId: string): Promise<string> {
    const { buffer, filename, mimetype, folderName } = file;

    try {
      // 파일 확장자 추출
      const fileExtension = file.filename.split('.').pop();
      const key = `${S3_FOLDER_NAMES[folderName]}/${userId}/${uuid()}.${fileExtension}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const publicUrl = this.getPublicUrl(key);

      this.logger.log(`File uploaded successfully: ${key}`);

      return publicUrl;
    } catch (error) {
      console.error('S3 upload error:', {
        message: error.message,
        code: error.code,
        details: error,
      });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('파일 업로드 중 오류가 발생했습니다.');
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      // 파일 존재 확인
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );

      // 삭제
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );

      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      if (error.name === 'NotFound') {
        throw new NotFoundException('파일을 찾을 수 없습니다.');
      }
      throw new BadRequestException('파일 삭제 중 오류가 발생했습니다.');
    }
  }

  private getPublicUrl(key: string): string {
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
