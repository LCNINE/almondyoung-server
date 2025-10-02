import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '@app/db';
import { uploads, productImages, pimSchema } from '../schema';
import { v7 as uuidv7 } from 'uuid';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';
import { eq } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { MultipartFile } from '@fastify/multipart';

// SSOT: schema.ts에서 타입 추출
type CreateUpload = InferInsertModel<typeof uploads>;
type CreateProductImage = InferInsertModel<typeof productImages>;

export interface ImageUploadResult {
  uploadId: string;
  url: string;
  fileName: string;
  originalName: string;
}

@Injectable()
export class ImageService implements OnModuleInit {
  private readonly uploadDir = './images';
  private readonly baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  constructor(private readonly db: DbService<typeof pimSchema>) {}

  async onModuleInit() {
    await this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    if (!existsSync(this.uploadDir)) {
      await mkdir(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(file: MultipartFile): Promise<ImageUploadResult> {
    try {
      // 파일 검증
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        throw new Error('Invalid image format');
      }

      // Fastify multipart file buffer 처리
      const buffer = await file.toBuffer();
      const size = buffer.length;

      if (size > 10 * 1024 * 1024) {
        throw new Error('File size exceeds limit');
      }

      // 고유 파일명 생성 (기존 방식과 동일)
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = extname(file.filename);
      const fileName = `${uniqueSuffix}${ext}`;
      const filePath = join(this.uploadDir, fileName);
      const url = `${this.baseUrl}/images/${fileName}`; // 기존 경로와 동일

      // 파일 저장
      await writeFile(filePath, buffer);

      // DB에 업로드 정보 저장
      const uploadData: CreateUpload = {
        id: uuidv7(),
        fileName,
        originalName: file.filename,
        mimeType: file.mimetype,
        filePath,
        url,
        size,
      };

      await this.db.db.insert(uploads).values(uploadData);

      return {
        uploadId: uploadData.id!,
        url,
        fileName,
        originalName: file.filename,
      };
    } catch (error) {
      throw new Error(`File upload failed: ${error.message}`);
    }
  }

  async uploadFromUrl(imageUrl: string): Promise<ImageUploadResult> {
    try {
      // URL 검증
      const url = new URL(imageUrl);

      // 이미지 다운로드
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error('Failed to download image from URL');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.match(/image\/(jpg|jpeg|png|gif|webp)/)) {
        throw new Error('Invalid image format from URL');
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const size = buffer.length;

      if (size > 10 * 1024 * 1024) {
        throw new Error('Downloaded image size exceeds limit');
      }

      // 파일명 생성
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = this.getExtensionFromContentType(contentType);
      const fileName = `${uniqueSuffix}${ext}`;
      const filePath = join(this.uploadDir, fileName);
      const fileUrl = `${this.baseUrl}/images/${fileName}`;

      // 파일 저장
      await writeFile(filePath, buffer);

      // DB에 업로드 정보 저장
      const uploadData: CreateUpload = {
        id: uuidv7(),
        fileName,
        originalName: url.pathname.split('/').pop() || fileName,
        mimeType: contentType,
        filePath,
        url: fileUrl,
        size,
      };

      await this.db.db.insert(uploads).values(uploadData);

      return {
        uploadId: uploadData.id!,
        url: fileUrl,
        fileName,
        originalName: uploadData.originalName,
      };
    } catch (error) {
      throw new Error(`URL upload failed: ${error.message}`);
    }
  }

  async createProductImage(
    masterId: string,
    uploadId: string,
    isPrimary: boolean = false,
    sortOrder: number = 0,
  ): Promise<void> {
    const productImageData: CreateProductImage = {
      id: uuidv7(),
      masterId,
      uploadId,
      isPrimary,
      sortOrder,
    };

    await this.db.db.insert(productImages).values(productImageData);
  }

  async deleteFile(uploadId: string): Promise<void> {
    try {
      // DB에서 파일 정보 조회
      const upload = await this.db.db
        .select()
        .from(uploads)
        .where(eq(uploads.id, uploadId))
        .limit(1);

      if (upload.length > 0) {
        // 파일 삭제
        try {
          await unlink(upload[0].filePath);
        } catch (error) {
          // 파일이 이미 없어도 계속 진행
        }

        // DB에서 삭제
        await this.db.db.delete(uploads).where(eq(uploads.id, uploadId));
      }
    } catch (error) {
      // 삭제 실패해도 에러 던지지 않음 (cleanup 용도)
    }
  }

  private getExtensionFromContentType(contentType: string): string {
    const typeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };
    return typeMap[contentType] || '.jpg';
  }
}
