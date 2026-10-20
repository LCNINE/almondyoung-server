import { ExecutionContext, Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_KEY_AUTH_ROUTE_KEY } from '../decorators/key-auth-route.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { IS_STORE_ROUTE_KEY } from '../decorators/store-route.decorator';

export type RouteRequirement =
  | { readonly kind: 'open' }
  | { readonly kind: 'permission'; readonly anyOf: readonly string[] }
  | { readonly kind: 'unclassified' };

export interface ResolvedRoute {
  readonly requirement: RouteRequirement;
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

    const parts = [
      segment(Reflect.getMetadata(PATH_METADATA, controller)),
      segment(Reflect.getMetadata(PATH_METADATA, handler)),
    ];
    const resolved: ResolvedRoute = { requirement, path: '/' + parts.filter(Boolean).join('/') };
    this.cache.set(handler, resolved);
    return resolved;
  }
}
