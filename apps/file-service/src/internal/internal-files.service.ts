import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { FileRepository } from '../shared/repositories/file.repository';
import { StorageService } from '../storage/storage.service';

/**
 * soft delete 뒤 S3 객체까지 지우기 전에 기다리는 기간.
 *
 * 오판을 되돌릴 창이다. 이 기간 안에는 uploads.status 를 active 로 돌리면 객체가
 * 그대로 있어 복구된다.
 */
export const OBJECT_PURGE_GRACE_DAYS = 14;

@Injectable()
export class InternalFilesService {
  private readonly logger = new Logger(InternalFilesService.name);

  constructor(
    private readonly repo: FileRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * 파일의 소유자와 컨텍스트를 돌려준다. 첨부를 받는 서비스가 「이 fileId 가 정말
   * 그 사람이 그 용도로 올린 것인지」를 확인하는 용도다 — 사용자용
   * `GET /files/:id/metadata` 는 `uploadedBy` 를 일부러 안 내려보내므로 여기 둔다.
   */
  async describe(fileId: string): Promise<{
    id: string;
    contextId: string;
    uploadedBy: string;
    status: string;
    mimeType: string;
  }> {
    const file = await this.repo.findById(fileId);
    if (!file) throw new NotFoundError('File not found');

    return {
      id: file.id,
      contextId: file.contextId,
      uploadedBy: file.uploadedBy,
      status: file.status,
      mimeType: file.mimeType,
    };
  }

  /** 행만 deleted 로 바꾼다. S3 객체는 남는다. */
  async softDelete(fileId: string): Promise<{ success: boolean }> {
    const file = await this.repo.findById(fileId);
    if (!file) throw new NotFoundError('File not found');
    if (file.status === 'deleted') return { success: true };

    await this.repo.softDelete(fileId);
    this.logger.log(`내부 soft delete fileId=${fileId} context=${file.contextId}`);
    return { success: true };
  }

  /**
   * soft delete 를 되돌린다. 유예기간 안에 다시 쓰이게 된 파일을 살리는 길이다.
   */
  async restore(fileId: string): Promise<{ success: boolean }> {
    const file = await this.repo.findById(fileId);
    if (!file) throw new NotFoundError('File not found');
    if (file.status === 'active') return { success: true };

    await this.repo.updateStatus(fileId, 'active', { deletedAt: null });
    this.logger.log(`내부 복구 fileId=${fileId} context=${file.contextId}`);
    return { success: true };
  }

  /**
   * S3 객체와 행을 지운다. 되돌릴 수 없다.
   *
   * 이미 soft delete 됐고 유예기간이 지난 파일만 받는다. 호출자가 시점을 잘못 계산해도
   * 여기서 막히도록 조건을 서버에 둔다.
   */
  async purgeObject(fileId: string): Promise<{ success: boolean }> {
    const file = await this.repo.findById(fileId);
    if (!file) throw new NotFoundError('File not found');

    if (file.status !== 'deleted' || !file.deletedAt) {
      throw new BadRequestError('File is not soft-deleted');
    }

    const graceEndsAt = new Date(file.deletedAt.getTime() + OBJECT_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (graceEndsAt > new Date()) {
      throw new BadRequestError(`File is still within the ${OBJECT_PURGE_GRACE_DAYS}-day grace period`);
    }

    await this.storage.delete({ key: file.filePath, isPublic: file.isPublic });
    await this.repo.hardDelete(fileId);
    this.logger.log(`내부 purge fileId=${fileId} key=${file.filePath}`);
    return { success: true };
  }
}
