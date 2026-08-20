import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ForbiddenError, NotFoundError } from '@app/shared';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { FileContextRepository } from '../shared/repositories/file-context.repository';
import { FileContextValidator } from '../shared/services/file-context-validator.service';
import { FileTypeDetector } from '../shared/services/file-type-detector.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { PresignUploadDto, PresignUploadResponseDto } from './dto/presign-upload.dto';
import { Upload } from '../shared/types/file.types';
import { v7 as uuidv7 } from 'uuid';

/** presigned PUT URL 유효 시간. 발급 직후 바로 올리는 흐름이라 길 이유가 없다 */
const PRESIGN_EXPIRES_IN_SECONDS = 600;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly pathBuilder: PathBuilderService,
    private readonly fileRepository: FileRepository,
    private readonly fileContextRepository: FileContextRepository,
    private readonly contextValidator: FileContextValidator,
    private readonly fileTypeDetector: FileTypeDetector,
  ) {}

  async uploadFile(file: Express.Multer.File, dto: UploadFileDto, userId: string): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestError('File is required');
    }

    const contextId = dto.contextId ?? dto.context;
    const context = await this.loadActiveContext(contextId);

    this.contextValidator.validateFileSize(context, file.size);

    const normalizedClientMimeType = this.fileTypeDetector.normalizeClientMimeType(file.mimetype);

    const detectedMimeType = await this.fileTypeDetector.detectMimeType(file.buffer);

    if (detectedMimeType) {
      this.contextValidator.validateMimeType(context, detectedMimeType);

      const clientValid = this.contextValidator.isValidMimeType(context, normalizedClientMimeType);
      if (!clientValid) {
        this.logger.warn(
          `Client MIME type not in whitelist - ` +
            `Client: ${normalizedClientMimeType} (original: ${file.mimetype}), Detected: ${detectedMimeType}. ` +
            `File: ${file.originalname}, User: ${userId}, Context: ${context.id}`,
        );
      }
    } else {
      this.contextValidator.validateMimeType(context, normalizedClientMimeType);
      this.logger.debug(`Using client Content-Type (normalized): ${normalizedClientMimeType}`);
    }

    const isPublic = this.contextValidator.resolveIsPublic(context, dto.isPublic);

    const fileId = uuidv7();
    const extension = this.getFileExtension(file.originalname);

    const filePath = this.pathBuilder.buildPath({
      prefix: context.pathPrefix,
      fileId,
      extension,
    });

    const uploadResult = await this.storageService.upload({
      key: filePath,
      buffer: file.buffer,
      contentType: normalizedClientMimeType,
      isPublic,
      metadata: {
        uploadedBy: userId,
        contextId: context.id,
      },
    });

    const fileRecord = await this.fileRepository.create({
      id: fileId,
      fileName: `${fileId}.${extension}`,
      originalName: file.originalname,
      filePath: uploadResult.key,
      url: uploadResult.url,
      size: file.size,
      mimeType: normalizedClientMimeType,
      status: 'active',
      contextId: context.id,
      uploadedBy: userId,
      storageProvider: uploadResult.provider.toLowerCase(),
      isPublic,
      metadata: dto.metadata,
      activatedAt: new Date(),
    });

    return this.toUploadResponse(fileRecord);
  }

  /**
   * 브라우저가 스토리지에 직접 PUT 할 presigned URL 을 발급한다. 서버가 파일 바이트를
   * 보지 못하므로 검증은 신고값(크기·MIME) 기준이고, 실제 객체 검증은 confirm 에서 한다.
   */
  async presignUpload(dto: PresignUploadDto, userId: string): Promise<PresignUploadResponseDto> {
    const direct = this.storageService.getDirectUploadPort();
    if (!direct) {
      // 404 는 "이 서버엔 직접 업로드가 없다"는 신호 — 구버전 서버의 미존재 라우트
      // 404 와 같은 코드로 내려, 클라이언트가 한 가지 조건으로 프록시 업로드에 폴백한다
      throw new NotFoundError('Direct upload is not supported by the current storage provider');
    }

    const context = await this.loadActiveContext(dto.contextId);

    this.contextValidator.validateFileSize(context, dto.size);

    const mimeType = this.fileTypeDetector.normalizeClientMimeType(dto.mimeType);
    this.contextValidator.validateMimeType(context, mimeType);

    const isPublic = this.contextValidator.resolveIsPublic(context, dto.isPublic);

    const fileId = uuidv7();
    const extension = this.getFileExtension(dto.fileName);

    const filePath = this.pathBuilder.buildPath({
      prefix: context.pathPrefix,
      fileId,
      extension,
    });

    const directUpload = await direct.createDirectUpload({
      key: filePath,
      contentType: mimeType,
      isPublic,
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });

    await this.fileRepository.create({
      id: fileId,
      fileName: `${fileId}.${extension}`,
      originalName: dto.fileName,
      filePath,
      url: directUpload.fileUrl,
      size: dto.size,
      mimeType,
      status: 'pending',
      contextId: context.id,
      uploadedBy: userId,
      storageProvider: directUpload.provider.toLowerCase(),
      isPublic,
      metadata: dto.metadata,
    });

    return {
      fileId,
      uploadUrl: directUpload.uploadUrl,
      headers: directUpload.headers,
      expiresAt: directUpload.expiresAt,
    };
  }

  /**
   * 직접 PUT 완료 통보. 스토리지에 객체가 실재하는지 확인하고, 실측 크기로 컨텍스트
   * 상한을 다시 검증한 뒤(presign 은 신고 크기만 봤다) active 로 전환한다.
   */
  async confirmUpload(fileId: string, userId: string): Promise<UploadResponseDto> {
    const file = await this.fileRepository.findById(fileId);
    if (!file || file.status === 'deleted') {
      throw new NotFoundError('File not found');
    }
    if (file.uploadedBy !== userId) {
      throw new ForbiddenError('You do not have permission to confirm this file');
    }
    if (file.status === 'active') {
      // confirm 재시도 멱등 처리
      return this.toUploadResponse(file);
    }

    const direct = this.storageService.getDirectUploadPort();
    if (!direct) {
      throw new NotFoundError('Direct upload is not supported by the current storage provider');
    }

    const head = await direct.headObject({ key: file.filePath, isPublic: file.isPublic });
    if (!head) {
      throw new BadRequestError('File has not been uploaded to storage');
    }

    const context = await this.fileContextRepository.findById(file.contextId);
    if (context && head.size > context.maxFileSize) {
      await this.storageService.delete({ key: file.filePath, isPublic: file.isPublic });
      await this.fileRepository.softDelete(file.id);
      this.contextValidator.validateFileSize(context, head.size);
    }

    // Content-Type 은 presign 서명에 들어가지 않아 실제 PUT 된 값이 신고값과 다를 수
    // 있다 — 객체에 저장된 타입으로 화이트리스트를 다시 강제한다
    const actualMimeType = head.contentType ? this.fileTypeDetector.normalizeClientMimeType(head.contentType) : null;
    if (context && actualMimeType && !this.contextValidator.isValidMimeType(context, actualMimeType)) {
      await this.storageService.delete({ key: file.filePath, isPublic: file.isPublic });
      await this.fileRepository.softDelete(file.id);
      this.contextValidator.validateMimeType(context, actualMimeType);
    }

    const updated = await this.fileRepository.updateStatus(file.id, 'active', {
      size: head.size,
      ...(actualMimeType ? { mimeType: actualMimeType } : {}),
      activatedAt: new Date(),
    });

    return this.toUploadResponse(updated);
  }

  async batchUploadFiles(
    files: Express.Multer.File[],
    dto: UploadFileDto,
    userId: string,
  ): Promise<BatchUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestError('At least one file is required');
    }

    const uploadPromises = files.map((file) => this.uploadFile(file, dto, userId));

    const uploadedFiles = await Promise.all(uploadPromises);

    return {
      files: uploadedFiles,
      total: uploadedFiles.length,
    };
  }

  private async loadActiveContext(contextId: string | undefined) {
    if (!contextId) {
      throw new BadRequestError('contextId is required');
    }

    const context = await this.fileContextRepository.findById(contextId);

    if (!context) {
      throw new NotFoundError(`Context ${contextId} not found`);
    }

    if (!context.isActive) {
      throw new BadRequestError(`${context.name} is currently disabled`);
    }

    return context;
  }

  private toUploadResponse(file: Upload): UploadResponseDto {
    return {
      id: file.id,
      url: file.url,
      fileName: file.fileName,
      size: file.size,
      status: file.status,
      isPublic: file.isPublic,
    };
  }

  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop() || '' : '';
  }
}
