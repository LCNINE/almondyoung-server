import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { FileContextRepository } from '../shared/repositories/file-context.repository';
import { FileContextValidator } from '../shared/services/file-context-validator.service';
import { FileTypeDetector } from '../shared/services/file-type-detector.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { v7 as uuidv7 } from 'uuid';

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

    const context = await this.fileContextRepository.findById(dto.contextId);

    if (!context) {
      throw new NotFoundError(`Context ${dto.contextId} not found`);
    }

    if (!context.isActive) {
      throw new BadRequestError(`${context.name} is currently disabled`);
    }

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
        contextId: dto.contextId,
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
      contextId: dto.contextId,
      uploadedBy: userId,
      storageProvider: uploadResult.provider.toLowerCase(),
      isPublic,
      metadata: dto.metadata,
      activatedAt: new Date(),
    });

    return {
      id: fileRecord.id,
      url: fileRecord.url,
      fileName: fileRecord.fileName,
      size: fileRecord.size,
      status: fileRecord.status,
      isPublic: fileRecord.isPublic,
    };
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

  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop() || '' : '';
  }
}
