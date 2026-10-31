import { ExecutionContext, Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_KEY_AUTH_ROUTE_KEY } from '../decorators/key-auth-route.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { IS_SERVICE_KEY_ROUTE_KEY } from '../decorators/service-key-route.decorator';
import { IS_STORE_ROUTE_KEY } from '../decorators/store-route.decorator';

export type RouteRequirement =
  | { readonly kind: 'open' }
  | { readonly kind: 'permission'; readonly anyOf: readonly string[] }
  | { readonly kind: 'unclassified' };

/**
 * 공유 서비스 문(`ServedTenantGate`)이 이 라우트에서 무엇으로 테넌트를 보나.
 * token = 사람 토큰(권한·고객 라우트), service = 테넌트 헤더(서비스 키), none = 보지 않는다(공개·머천트 키, 그리고
 * 토큰이 왔을 때만 보는 선택 인증 — 그건 `OptionalAuthGuard` 가 토큰을 읽은 뒤 본다).
 */
export type TenantEntry = 'token' | 'service' | 'none';

export interface ResolvedRoute {
  readonly requirement: RouteRequirement;
  readonly tenantEntry: TenantEntry;
  /** 로그에 쓰는 라우트 패턴(`/orders/:id`). 실제 URL 이 아니라 식별자·쿼리가 섞이지 않는다. */
  readonly path: string;
}

/** 공개·선택 인증·고객·키 — 권한을 따지지 않는 표식들. */
const OPEN_MARKERS = [IS_PUBLIC_KEY, IS_OPTIONAL_AUTH_KEY, IS_STORE_ROUTE_KEY, IS_KEY_AUTH_ROUTE_KEY];

const segment = (value: unknown): string => {
  const raw: unknown = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.replace(/^\/+|\/+$/g, '') : '';
};

@Injectable()
export class RouteRequirementResolver {
  /** 메타데이터는 부팅 뒤 바뀌지 않으므로 핸들러마다 한 번만 읽는다. */
  private readonly cache = new WeakMap<object, ResolvedRoute>();

  constructor(private readonly reflector: Reflector) {}

  resolve(context: ExecutionContext): ResolvedRoute {
    const handler = context.getHandler();
    const hit = this.cache.get(handler);
    if (hit) return hit;

    const controller = context.getClass();
    const targets = [handler, controller];
    const anyOf = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, targets);
    const requirement: RouteRequirement =
      anyOf && anyOf.length > 0
        ? { kind: 'permission', anyOf }
        : OPEN_MARKERS.some((key) => this.reflector.getAllAndOverride<boolean>(key, targets) === true)
          ? { kind: 'open' }
          : { kind: 'unclassified' };

    const flag = (key: string) => this.reflector.getAllAndOverride<boolean>(key, targets) === true;
    const tenantEntry: TenantEntry =
      requirement.kind === 'permission' || flag(IS_STORE_ROUTE_KEY)
        ? 'token'
        : flag(IS_SERVICE_KEY_ROUTE_KEY)
          ? 'service'
          : 'none';

    const parts = [
      segment(Reflect.getMetadata(PATH_METADATA, controller)),
      segment(Reflect.getMetadata(PATH_METADATA, handler)),
    ];
    const resolved: ResolvedRoute = { requirement, tenantEntry, path: '/' + parts.filter(Boolean).join('/') };
    this.cache.set(handler, resolved);
    return resolved;
  }
}
