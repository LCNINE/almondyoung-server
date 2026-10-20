import { ServerResponse } from 'node:http';

/** 인증된 사용자의 역할. 인증 안 된 요청은 undefined, 역할 없이 인증된 요청은 []. */
export function rolesOf(request: unknown): string[] | undefined {
  if (typeof request !== 'object' || request === null || !('user' in request)) return undefined;
  const user: unknown = request.user;
  if (typeof user !== 'object' || user === null) return undefined;
  if (!('roles' in user) || !Array.isArray(user.roles)) return [];
  return user.roles.filter((role): role is string => typeof role === 'string');
}

export function methodOf(request: unknown): string {
  if (typeof request === 'object' && request !== null && 'method' in request && typeof request.method === 'string') {
    return request.method;
  }
  return '?';
}

/** Express 는 응답 자체가, Fastify 는 `reply.raw` 가 node 응답이다. */
export function rawResponseOf(response: unknown): ServerResponse | undefined {
  if (response instanceof ServerResponse) return response;
  if (
    typeof response === 'object' &&
    response !== null &&
    'raw' in response &&
    response.raw instanceof ServerResponse
  ) {
    return response.raw;
  }
  return undefined;
}
