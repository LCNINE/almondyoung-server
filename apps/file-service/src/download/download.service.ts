import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from '@app/authorization';
import { StorageService } from '../storage/storage.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

@Injectable()
export class DownloadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly fileRepository: FileRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /**
   * Check if user has permission to access the file
   * - Public files: accessible by anyone
   * - Private files: only owner or master scope holders
   */
  private async checkFileAccess(file: any, user: JwtPayload): Promise<void> {
    // Public files are accessible by everyone
    if (file.isPublic) {
      return;
    }

    // For private files, check ownership
    const isMaster = await this.authorizationService.hasScope(user, 'master');
    const isOwner = file.uploadedBy === user.userId;

    if (!isMaster && !isOwner) {
      throw new ForbiddenException('You do not have permission to access this file');
    }
  }

  async getSignedUrl(fileId: string, expiresIn: number = 3600, user: JwtPayload): Promise<SignedUrlResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status !== 'active') {
      throw new BadRequestException('File is not active');
    }

    // Check access permission
    await this.checkFileAccess(file, user);

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

  async getMetadata(fileId: string, user: JwtPayload): Promise<FileMetadataResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Check access permission
    await this.checkFileAccess(file, user);

    // For private files, exclude URL from response
    const response: FileMetadataResponseDto = {
      id: file.id,
      fileName: file.fileName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      status: file.status,
      contextId: file.contextId,
      isPublic: file.isPublic,
      metadata: file.metadata,
      createdAt: file.createdAt,
      activatedAt: file.activatedAt,
    };

    // Only include URL for public files
    if (file.isPublic) {
      response.url = file.url;
    }

    return response;
  }
}
