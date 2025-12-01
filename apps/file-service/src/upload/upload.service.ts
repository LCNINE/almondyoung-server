import { Injectable, BadRequestException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { v7 as uuidv7 } from 'uuid';
import { MultipartFile } from '@fastify/multipart'; // 제공해주신 타입 정의@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly pathBuilder: PathBuilderService,
    private readonly fileRepository: FileRepository,
  ) {}

  async uploadFile(file: MultipartFile, dto: UploadFileDto, userId: string): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileId = uuidv7();
    const extension = this.getFileExtension(file.filename);

    const filePath = this.pathBuilder.buildPath({
      context: dto.context,
      fileId,
      extension,
      userId: this.shouldIncludeUserId(dto.context) ? userId : undefined,
      status: 'active',
    });

    const uploadResult = await this.storageService.upload({
      key: filePath,
      stream: file.file, //buffer에서 stream으로 변환 추후 문제가되면 수정
      contentType: file.mimetype,
      metadata: {
        uploadedBy: userId,
        context: dto.context,
      },
    });

    const fileRecord = await this.fileRepository.create({
      id: fileId,
      fileName: `${fileId}.${extension}`,
      originalName: file.filename,
      filePath: uploadResult.key,
      url: uploadResult.url,
      size: 0, //일단 0으로 처리 추후 스트림을 읽어서 계산해야함
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
    files: MultipartFile[], // VAP-FIX: Changed by Gemini to accept an array
    dto: UploadFileDto,
    userId: string,
  ): Promise<BatchUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const uploadPromises: Promise<UploadResponseDto>[] = [];

    // VAP-FIX: Changed by Gemini to iterate over an array
    for (const file of files) {
      uploadPromises.push(this.uploadFile(file, dto, userId));
    }

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
