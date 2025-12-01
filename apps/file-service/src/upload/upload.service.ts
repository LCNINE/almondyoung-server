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
      buffer: await file.toBuffer(),
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
    files: AsyncIterableIterator<MultipartFile>, // Fastify 타입 그대로 수용
    dto: UploadFileDto,
    userId: string,
  ): Promise<BatchUploadResponseDto> {
    const uploadPromises: Promise<UploadResponseDto>[] = [];
    let fileCount = 0;

    // 1. 🚀 for await...of 루프를 사용하여 비동기 이터레이터 소비
    //    => 이터레이터의 각 요소에 대해 this.uploadFile을 호출하고 Promise를 배열에 추가
    for await (const file of files) {
      uploadPromises.push(this.uploadFile(file, dto, userId));
      fileCount++;
    }

    // 2. 🚨 파일 개수 확인 (length 대신 count 사용)
    if (fileCount === 0) {
      throw new BadRequestException('At least one file is required');
    }

    // 3. ⏱️ 모든 Promise를 병렬로 실행
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
