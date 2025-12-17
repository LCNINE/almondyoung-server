import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';

@Injectable()
export class DownloadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly fileRepository: FileRepository,
  ) { }

  async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<SignedUrlResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status !== 'active') {
      throw new BadRequestException('File is not active');
    }

    if (file.isPublic) {
      return {
        signedUrl: file.url,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };
    }

    const signedUrlResult = await this.storageService.getSignedUrl({
      key: file.filePath,
      expiresIn,
      operation: 'get',
      isPublic: false,
    });

    return {
      signedUrl: signedUrlResult.signedUrl,
      expiresAt: signedUrlResult.expiresAt,
    };
  }

  async getMetadata(fileId: string): Promise<FileMetadataResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return {
      id: file.id,
      fileName: file.fileName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: file.url,
      status: file.status,
      contextId: file.contextId,
      isPublic: file.isPublic,
      metadata: file.metadata,
      createdAt: file.createdAt,
      activatedAt: file.activatedAt,
    };
  }
}

