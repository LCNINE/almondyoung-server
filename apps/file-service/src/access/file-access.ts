import { Injectable } from '@nestjs/common';
import { NotFoundError, ForbiddenError } from '@app/shared';
import { AuthzSubject, Permission, PermissionCheckpoints, systemPrincipal } from '@app/authorization';
import { FileRepository } from '../shared/repositories/file.repository';
import { ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID, DIGITAL_ASSET_FILE_CONTEXT_ID } from '../database/default-file-contexts';
import { Upload } from '../shared/types/file.types';
import { JwtPayload } from '../shared/types/jwt-payload.interface';
import { delegationOf, FileDelegate } from './service-delegation';

export interface DeleteResult {
  success: boolean;
  message: string;
}

// 직원이 소유자가 아니어도 읽을 수 있는 컨텍스트와, 그 파일을 여는 화면의 조회 권한.
// 어드민에서 등록한 디지털 상품 파일을 검수하려면 필요하다. 고객 업로드물
// (사업자등록증 등)은 여기 넣지 말 것 — 읽기 권한이 곧 개인정보 열람이다.
//
// 아카이브 첨부는 사내 문서에 딸린 파일이라 «올린 사람만 읽는» 것이 오히려 틀렸다 —
// 문서 자체가 팀 스페이스에서 관리자 전체에게 열려 있는데 첨부만 못 열면 문서가 반쪽이 된다.
// 이관은 계정 하나가 전부 올리므로, 이 줄이 없으면 나머지 관리자에게 403 이 된다.
const STAFF_CONTEXT_PERMISSIONS: ReadonlyMap<string, Permission> = new Map<string, Permission>([
  [DIGITAL_ASSET_FILE_CONTEXT_ID, 'catalog.product.read'],
  [ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID, 'archive.page.read'],
]);

/** 서비스 위임 토큰의 주체. 사람 주체가 아니다. */
const FILE_DELEGATION: Readonly<Record<FileDelegate, AuthzSubject>> = {
  core: systemPrincipal('core.file-delegation'),
  'ugc-service': systemPrincipal('ugc-service.file-delegation'),
};

@Injectable()
export class FileAccess {
  constructor(
    private readonly repo: FileRepository,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  async loadReadable(fileId: string, user: JwtPayload): Promise<Upload> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status !== 'active') {
      throw new NotFoundError('File not found');
    }
    if (file.isPublic) {
      return file;
    }
    if (this.isOwnerOrFileManager(file, user)) {
      return file;
    }
    const contextPermission = STAFF_CONTEXT_PERMISSIONS.get(file.contextId);
    if (
      contextPermission &&
      this.checkpoints.check('file.staff_context_read', this.subjectOf(user), [contextPermission])
    ) {
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
    if (!this.isOwnerOrFileManager(file, user)) {
      throw new ForbiddenError('You do not have permission to delete this file');
    }
    if (file.contextId === 'attendance-request-image') {
      throw new ForbiddenError('출결 참고 이미지는 보관 정책에 따라 관리됩니다.');
    }
    await this.repo.softDelete(fileId);
    return { success: true, message: 'File deleted successfully' };
  }

  /** 판정 지점에 넘길 주체. 허용된 서비스의 위임 토큰은 시스템 주체다. */
  private subjectOf(user: JwtPayload): AuthzSubject {
    const delegation = delegationOf(user);
    return delegation ? FILE_DELEGATION[delegation.delegate] : { roles: user.roles ?? [] };
  }

  private isOwnerOrFileManager(file: Upload, user: JwtPayload): boolean {
    if (file.uploadedBy === user.userId) return true;
    return this.checkpoints.check('file.owner_exception', this.subjectOf(user), ['system.file.manage']);
  }
}
