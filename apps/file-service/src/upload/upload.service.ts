import { Injectable, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { FileContextRepository } from '../shared/repositories/file-context.repository';
import { FileContextValidator } from '../shared/services/file-context-validator.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly pathBuilder: PathBuilderService,
    private readonly fileRepository: FileRepository,
    private readonly fileContextRepository: FileContextRepository,
    private readonly contextValidator: FileContextValidator,
  ) {}

  async uploadFile(file: Express.Multer.File, dto: UploadFileDto, userId: string): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    try {
      const context = await this.fileContextRepository.findById(dto.contextId);

      if (!context) {
        throw new NotFoundException(`Context ${dto.contextId} not found`);
      }

      if (!context.isActive) {
        throw new BadRequestException(`${context.name} is currently disabled`);
      }

      this.contextValidator.validateMimeType(context, file.mimetype);
      this.contextValidator.validateFileSize(context, file.size);

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
        contentType: file.mimetype,
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
        mimeType: file.mimetype,
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
    } catch (error) {
      console.error('파일업로드 에러 :', error);
      throw new BadRequestException({
        message: error.message ?? '파일 업로드 중 오류가 발생했습니다.',
        errorCode: error.errorCode ?? 'FILE_UPLOAD_FAILED',
        httpStatus: HttpStatus.BAD_REQUEST,
      });
    }
  }

  async batchUploadFiles(
    files: Express.Multer.File[],
    dto: UploadFileDto,
    userId: string,
  ): Promise<BatchUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
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
