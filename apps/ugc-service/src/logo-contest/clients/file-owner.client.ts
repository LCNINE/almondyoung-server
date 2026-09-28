import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestError } from '@app/shared';
import { ALLOWED_IMAGE_MIME_TYPES, LOGO_CONTEST_IMAGE_CONTEXT_ID } from '../constants/logo-contest.constants';

interface FileDescription {
  id: string;
  contextId: string;
  uploadedBy: string;
  status: string;
  mimeType: string;
  width?: number;
  height?: number;
}

/**
 * 출품에 붙은 fileId 가 정말 본인이 그 용도로 올린 파일인지 확인한다.
 *
 * 리뷰의 `normalizeMediaFileIds` 는 개수·중복만 보기 때문에 남의 fileId 를 그대로 붙일 수
 * 있다. 공모전은 게시판에 바로 노출되므로 그 구멍을 여기서 막는다.
 */
@Injectable()
export class FileOwnerClient {
  private readonly logger = new Logger(FileOwnerClient.name);
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(configService: ConfigService) {
    this.baseUrl = (configService.get<string>('FILE_SERVICE_URL') ?? 'http://localhost:3010').replace(/\/+$/, '');
    this.internalKey = configService.get<string>('FILE_SERVICE_INTERNAL_KEY') ?? '';
  }

  async assertOwnedImages(fileIds: string[], userId: string): Promise<void> {
    const described = await Promise.all(fileIds.map((fileId) => this.describe(fileId)));

    described.forEach((file, index) => {
      if (file.contextId !== LOGO_CONTEST_IMAGE_CONTEXT_ID) {
        throw new BadRequestError(`공모전 출품 이미지로 올린 파일이 아닙니다: ${file.id}`);
      }
      if (file.uploadedBy !== userId) {
        throw new BadRequestError(`본인이 올린 파일만 첨부할 수 있습니다: ${file.id}`);
      }
      // presign 업로드는 confirm 전까지 `pending` 이다 — 그 상태로 붙이면 게시판에 빈 칸이 걸린다.
      if (file.status !== 'active') {
        throw new BadRequestError(`업로드가 끝나지 않았거나 삭제된 파일입니다: ${file.id}`);
      }
      if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimeType)) {
        throw new BadRequestError(`jpg·png·webp 이미지만 첨부할 수 있습니다: ${file.id}`);
      }
      if (!file.width || !file.height) {
        throw new BadRequestError(`이미지 크기를 확인할 수 없습니다: ${file.id}`);
      }
      if (index === 0 && file.width <= file.height) {
        throw new BadRequestError('첫 번째 이미지는 가로가 세로보다 긴 로고여야 합니다.');
      }
      if (index === 1 && file.width !== file.height) {
        throw new BadRequestError('두 번째 이미지는 가로세로 크기가 같은 심볼이어야 합니다.');
      }
    });
  }

  private async describe(fileId: string): Promise<FileDescription> {
    const response = await fetch(`${this.baseUrl}/internal/files/${fileId}`, {
      headers: { Authorization: `Bearer ${this.internalKey}` },
      signal: AbortSignal.timeout(5_000),
    }).catch((error: unknown) => {
      this.logger.error(`file-service 조회 실패 fileId=${fileId}: ${String(error)}`);
      throw new BadRequestError('첨부 파일을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    });

    if (!response.ok) {
      this.logger.warn(`file-service 조회 ${response.status} fileId=${fileId}`);
      throw new BadRequestError(`첨부 파일을 확인할 수 없습니다: ${fileId}`);
    }

    return (await response.json()) as FileDescription;
  }
}
