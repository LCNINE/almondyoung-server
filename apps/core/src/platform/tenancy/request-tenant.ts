import { ForbiddenException } from '@nestjs/common';
import type { TenantList } from '@app/tenancy';

/**
 * 요청이 들어온 입구.
 * - token   : 사람 토큰 라우트(@RequirePermission·@StoreRoute·@OptionalAuth). 토큰의 `tenant` 가 맥락이다.
 * - service : 서비스 신원(내부 키, @InternalOnly). 키는 테넌트를 말하지 못하므로 테넌트 헤더가 맥락이다.
 * - public  : @Public. 사람 토큰이 오면 토큰, 아니면 호출자의 테넌트 헤더가 맥락이다.
 */
export type RequestEntry = 'token' | 'service' | 'public';

export interface RequestTenantInput {
  readonly entry: RequestEntry;
  /** 검증된 토큰의 사용자(`request.user`). 토큰이 없으면 undefined·null. */
  readonly user: object | null | undefined;
  /** `x-tenant-id` 헤더. */
  readonly header: string | undefined;
}

/**
 * 정해진 테넌트, 또는 «모르는 테넌트»(그 입구). 모르는 테넌트를 어떻게 다룰지는 전환 모드가 정한다.
 * `claimlessToken` = @Public 에서 헤더로 정했지만 클레임 없는 토큰이 함께 왔다 — 막지는 않되 세어 그 호출자를 찾는다.
 */
export type RequestTenant =
  | { readonly tenant: string; readonly claimlessToken?: true }
  | { readonly untenanted: RequestEntry };

function claimOf(user: object | null | undefined): string | undefined {
  if (!user || !('tenant' in user)) return undefined;
  const claim: unknown = user.tenant;
  return typeof claim === 'string' && claim !== '' ? claim : undefined;
}

/**
 * core 요청의 테넌트 맥락을 정한다. 토큰이 언제나 이기고, 헤더가 토큰과 다르면 누가 문을 고르려 한 것이라 거절한다.
 * 목록에 없는 테넌트는 두 모드 모두 거절한다 — «모르는» 게 아니라 틀린 값이다.
 *
 * 클레임 없는 토큰은 사람 토큰 라우트에선 «모르는 테넌트»다: 헤더가 대신하면 클레임 전 토큰의 역할(그 시절의 테넌트 1
 * 부여)이 헤더가 고른 테넌트에서 쓰인다. @Public 에선 토큰의 역할을 쓰지 않으므로 헤더가 공개 콘텐츠의 DB 를 고른다
 * (쇼핑몰은 로그인 세션의 옛 내부 토큰을 공개 조회에도 붙인다).
 */
export function resolveRequestTenant(input: RequestTenantInput, tenants: TenantList): RequestTenant {
  const claim = claimOf(input.user);
  const { header } = input;

  if (claim !== undefined && header !== undefined && header !== claim) {
    throw new ForbiddenException('테넌트 헤더가 토큰의 테넌트와 다릅니다.');
  }

  const claimlessToken = claim === undefined && !!input.user;
  if (claimlessToken && input.entry !== 'public') return { untenanted: 'token' };

  const tenant = claim ?? header;
  if (tenant === undefined) return { untenanted: input.entry };

  if (!tenants.find(tenant)) throw new ForbiddenException('테넌트 목록에 없는 테넌트입니다.');
  return claimlessToken ? { tenant, claimlessToken: true } : { tenant };
}
