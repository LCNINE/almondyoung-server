import { Injectable, BadRequestException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly pathBuilder: PathBuilderService,
    private readonly fileRepository: FileRepository,
  ) { }

  async uploadFile(
    file: Express.Multer.File,
    dto: UploadFileDto,
    userId: string,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileId = uuidv7();
    const extension = this.getFileExtension(file.originalname);

    const filePath = this.pathBuilder.buildPath({
      context: dto.context,
      fileId,
      extension,
      userId: this.shouldIncludeUserId(dto.context) ? userId : undefined,
      status: 'active',
    });

    const uploadResult = await this.storageService.upload({
      key: filePath,
      buffer: file.buffer,
      contentType: file.mimetype,
      metadata: {
        uploadedBy: userId,
        context: dto.context,
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
      context: dto.context,
      uploadedBy: userId,
      storageProvider: uploadResult.provider.toLowerCase(),
      metadata: dto.metadata,
      activatedAt: new Date(),
    });

    return {
      id: fileRecord.id,
      url: fileRecord.url,
      fileName: fileRecord.fileName,
      size: fileRecord.size,
      status: fileRecord.status,
    };
  }

  async batchUploadFiles(
    files: Express.Multer.File[],
    dto: UploadFileDto,
    userId: string,
  ): Promise<BatchUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const uploadPromises = files.map((file) =>
      this.uploadFile(file, dto, userId)
    );

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

  private shouldIncludeUserId(context: string): boolean {
    return context === 'user-avatar' || context === 'user-document';
  }
}
