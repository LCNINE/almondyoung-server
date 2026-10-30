import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import { IamAuditRepository, type AuditTx } from './iam-audit.repository';

export const IAM_AUDIT_ACTIONS = [
  'role.create',
  'role.update',
  'role.delete',
  'role.permissions.replace',
  'user.roles.replace',
  'role.members.add',
  'role.member.remove',
  'admin_user.create',
  'pii_access_log.view',
  'user.platform_operator.set',
  'tenant.create',
  'tenant.status.set',
  'tenant.delete',
  'tenant.membership.add',
  'tenant.oauth_redirects.add',
  'user.password.reissue',
] as const;
export const IAM_AUDIT_TARGET_TYPES = ['role', 'user', 'pii_access_log', 'tenant', 'oauth_client'] as const;
export type IamAuditTargetType = (typeof IAM_AUDIT_TARGET_TYPES)[number];
export type IamAuditAction = (typeof IAM_AUDIT_ACTIONS)[number];

export interface IamAuditEntry {
  /** 어느 테넌트에서 한 일인가. 역할 정의처럼 전역인 변경은 요청자가 일한 테넌트. 운영자 성질처럼 테넌트 밖의 일은 null. */
  readonly tenantId: string | null;
  readonly action: IamAuditAction;
  readonly targetType: IamAuditTargetType;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** 변경 이력 한 행. 변경과 같은 트랜잭션으로 부른다 — 이력을 못 쓰면 변경도 되돌아간다. */
@Injectable()
export class IamAuditCreator {
  constructor(private readonly repository: IamAuditRepository) {}

  record(tx: AuditTx, actor: IamActor, entry: IamAuditEntry): Promise<void> {
    return this.repository.insert(
      {
        actorUserId: actor.userId,
        actorLoginId: actor.loginId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetLabel: entry.targetLabel.slice(0, 100),
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: actor.ip,
        userAgent: actor.userAgent,
        requestId: actor.requestId,
        tenantId: entry.tenantId,
      },
      tx,
    );
  }
}
