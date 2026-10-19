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
] as const;
export type IamAuditAction = (typeof IAM_AUDIT_ACTIONS)[number];

export interface IamAuditEntry {
  readonly action: IamAuditAction;
  readonly targetType: 'role' | 'user';
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
        ip: null,
        userAgent: actor.userAgent,
        requestId: actor.requestId,
      },
      tx,
    );
  }
}
