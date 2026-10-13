import { Inject, Injectable } from '@nestjs/common';
import { PermissionCache } from './permission-cache';
import type { RouteRequirement } from './route-requirement.resolver';

export type DenyReason = 'unclassified' | 'unauthenticated' | 'missing_permission' | 'unavailable';
export type Verdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: DenyReason };

const ALLOW: Verdict = { allowed: true };

/** 역할 이름이 아니라 권한만 본다. master 도 user-service 가 계산한 권한 목록으로 판정된다. */
@Injectable()
export class PermissionDecider {
  constructor(@Inject(PermissionCache) private readonly cache: Pick<PermissionCache, 'permissionsFor'>) {}

  decide(requirement: RouteRequirement, roles: readonly string[] | undefined): Verdict {
    if (requirement.kind === 'open') return ALLOW;
    if (requirement.kind === 'unclassified') return { allowed: false, reason: 'unclassified' };
    if (roles === undefined) return { allowed: false, reason: 'unauthenticated' };
    const held = this.cache.permissionsFor(roles);
    if (held === null) return { allowed: false, reason: 'unavailable' };
    return requirement.anyOf.some((permission) => held.has(permission))
      ? ALLOW
      : { allowed: false, reason: 'missing_permission' };
  }

  /** 요구 권한 가운데 이 역할들이 가진 것. 사본이 없으면 null(판정 불가), 미인증이면 빈 목록. */
  grantedAmong(anyOf: readonly string[], roles: readonly string[] | undefined): readonly string[] | null {
    if (roles === undefined) return [];
    const held = this.cache.permissionsFor(roles);
    if (held === null) return null;
    return anyOf.filter((permission) => held.has(permission));
  }
}
