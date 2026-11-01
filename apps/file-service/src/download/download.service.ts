import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { FileAccess } from '../access/file-access';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';
import { JwtPayload } from '../shared/types/jwt-payload.interface';
import type { RequestTenantId } from '../tenancy/request-tenant';

@Injectable()
export class DownloadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly fileAccess: FileAccess,
  ) {}

  async getSignedUrl(
    fileId: string,
    expiresIn: number,
    user: JwtPayload,
    tenant: RequestTenantId,
    download = false,
  ): Promise<SignedUrlResponseDto> {
    const file = await this.fileAccess.loadReadable(fileId, user, tenant);

    if (file.isPublic) {
      return {
        signedUrl: file.url,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };
    }

    // download=true 면 강제 다운로드 + 원본 파일명 (RFC 5987). 미지정 시 브라우저 기본(inline) 동작.
    const responseContentDisposition = download
      ? `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`
      : undefined;

    // 버킷은 요청이 아니라 파일 행의 테넌트 것이다 — 객체가 거기 있다.
    const signedUrlResult = await this.storageService.getSignedUrl(file.tenantId, {
      key: file.filePath,
      expiresIn,
      operation: 'get',
      isPublic: false,
      responseContentDisposition,
    });

    return {
      signedUrl: signedUrlResult.signedUrl,
      expiresAt: signedUrlResult.expiresAt,
    };
  }

  async getMetadata(fileId: string, user: JwtPayload, tenant: RequestTenantId): Promise<FileMetadataResponseDto> {
    const file = await this.fileAccess.loadReadable(fileId, user, tenant);

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

    if (file.isPublic) {
      response.url = file.url;
    }

    return response;
  }

  /** 공개 파일은 맥락 없이 꺼내 준다 — URL 이 이미 행의 테넌트 공개 버킷을 가리킨다(올릴 때 정해졌다). */
  async resolvePublicUrl(fileId: string): Promise<string> {
    const file = await this.fileAccess.loadPublicServable(fileId);
    return file.url;
  }
}
