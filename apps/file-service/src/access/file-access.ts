import { Injectable } from '@nestjs/common';
import { NotFoundError, ForbiddenError } from '@app/shared';
import { AuthorizationService } from '@app/authorization';
import { FileRepository } from '../shared/repositories/file.repository';
import { Upload } from '../shared/types/file.types';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

export interface DeleteResult {
  success: boolean;
  message: string;
}

@Injectable()
export class FileAccess {
  constructor(
    private readonly repo: FileRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  async loadReadable(fileId: string, user: JwtPayload): Promise<Upload> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status !== 'active') {
      throw new NotFoundError('File not found');
    }
    if (file.isPublic) {
      return file;
    }
    if (await this.isMasterOrOwner(file, user)) {
      return file;
    }
    throw new ForbiddenError('You do not have permission to access this file');
  }

  async loadPublicServable(fileId: string): Promise<Upload> {
    const file = await this.repo.findById(fileId);
    if (!file || !file.isPublic || file.status !== 'active') {
      throw new NotFoundError('File not found');
    }
    return file;
  }

  async delete(fileId: string, user: JwtPayload): Promise<DeleteResult> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status === 'deleted') {
      throw new NotFoundError('File not found');
    }
    if (!(await this.isMasterOrOwner(file, user))) {
      throw new ForbiddenError('You do not have permission to delete this file');
    }
    await this.repo.softDelete(fileId);
    return { success: true, message: 'File deleted successfully' };
  }

  private async isMasterOrOwner(file: Upload, user: JwtPayload): Promise<boolean> {
    if (file.uploadedBy === user.userId) return true;
    // master 역할은 그 자체로 통과 — ScopeGuard/MasterRoleGuard 와 동일 컨벤션.
    // (admin master 계정은 roles: ['master'] 만 들고 오고 role→scope DB 매핑은 없음)
    if (user.roles?.includes('master')) return true;
    // Service-to-service 위임 토큰 (예: core 의 FileServiceClient) 은 roles 없이
    // scopes: ['master'] 만 들고 옴 — AuthorizationService.hasScope 가 roles 기반이라
    // JWT scopes 도 직접 확인해야 위임 경로가 동작.
    if (user.scopes?.includes('master')) return true;
    return this.authorization.hasScope(user, 'master');
  }
}
