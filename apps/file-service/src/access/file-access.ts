import { Injectable } from '@nestjs/common';
import { NotFoundError, ForbiddenError } from '@app/shared';
import {
  AuthorizationService,
  AuthzSubject,
  Permission,
  PermissionCheckpoints,
  STAFF_ROLES,
  systemPrincipal,
} from '@app/authorization';
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

/** 직원이 소유자가 아니어도 여는 컨텍스트와, 그 파일을 여는 화면의 조회 권한. */
const STAFF_CONTEXT_PERMISSIONS: ReadonlyMap<string, Permission> = new Map<string, Permission>([
  [DIGITAL_ASSET_FILE_CONTEXT_ID, 'catalog.product.read'],
  [ARCHIVE_PAGE_ATTACHMENT_CONTEXT_ID, 'archive.page.read'],
]);

/** core 의 서비스 위임 토큰(역할 없이 위임 스코프만). 사람 주체가 아니다. */
const CORE_FILE_DELEGATION = systemPrincipal('core.file-delegation');

@Injectable()
export class FileAccess {
  constructor(
    private readonly repo: FileRepository,
    private readonly authorization: AuthorizationService,
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
    if (await this.isMasterOrOwner(file, user)) {
      return file;
    }
    const contextPermission = STAFF_CONTEXT_PERMISSIONS.get(file.contextId);
    if (
      contextPermission &&
      this.checkpoints.compare(
        'file.staff_context_read',
        this.isStaff(user) && STAFF_READABLE_CONTEXT_IDS.includes(file.contextId),
        this.subjectOf(user),
        [contextPermission],
      )
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
    if (!(await this.isMasterOrOwner(file, user))) {
      throw new ForbiddenError('You do not have permission to delete this file');
    }
    await this.repo.softDelete(fileId);
    return { success: true, message: 'File deleted successfully' };
  }

  private isStaff(user: JwtPayload): boolean {
    return (user.roles ?? []).some((role) => STAFF_ROLES.includes(role));
  }

  /** 판정 지점에 넘길 주체. core 위임 토큰(역할 없음 + 위임 스코프)은 시스템 주체다 — 옛 판정과 같은 입력이다. */
  private subjectOf(user: JwtPayload): AuthzSubject {
    const roles = user.roles ?? [];
    return roles.length === 0 && user.scopes?.includes('master') ? CORE_FILE_DELEGATION : { roles };
  }

  private async isMasterOrOwner(file: Upload, user: JwtPayload): Promise<boolean> {
    if (file.uploadedBy === user.userId) return true;
    const legacy = await this.legacyOwnerException(user);
    return this.checkpoints.compare('file.owner_exception', legacy, this.subjectOf(user), ['system.file.manage']);
  }

  /** 소유자가 아닌데도 여는 옛 판정. 권한 판정은 옆에서 비교만 한다. */
  private async legacyOwnerException(user: JwtPayload): Promise<boolean> {
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
