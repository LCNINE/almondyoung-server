import { Injectable } from '@nestjs/common';
import { NotFoundError, ForbiddenError } from '@app/shared';
import { AuthorizationService, STAFF_ROLES } from '@app/authorization';
import { FileRepository } from '../shared/repositories/file.repository';
import { ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID, DIGITAL_ASSET_FILE_CONTEXT_ID } from '../database/default-file-contexts';
import { Upload } from '../shared/types/file.types';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

export interface DeleteResult {
  success: boolean;
  message: string;
}

// 직원(admin/master)이 소유자가 아니어도 읽을 수 있는 컨텍스트.
// 어드민에서 등록한 디지털 상품 파일을 검수하려면 필요하다. 고객 업로드물
// (사업자등록증 등)은 여기 넣지 말 것 — 읽기 권한이 곧 개인정보 열람이다.
//
// 아카이브 첨부는 사내 문서에 딸린 파일이라 «올린 사람만 읽는» 것이 오히려 틀렸다 —
// 문서 자체가 팀 스페이스에서 관리자 전체에게 열려 있는데 첨부만 못 열면 문서가 반쪽이 된다.
// 이관은 계정 하나가 전부 올리므로, 이 줄이 없으면 나머지 관리자에게 403 이 된다.
const STAFF_READABLE_CONTEXT_IDS: readonly string[] = [
  DIGITAL_ASSET_FILE_CONTEXT_ID,
  ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID,
];

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
    if (this.isStaff(user) && STAFF_READABLE_CONTEXT_IDS.includes(file.contextId)) {
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

  private isStaff(user: JwtPayload): boolean {
    return (user.roles ?? []).some((role) => STAFF_ROLES.includes(role));
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
