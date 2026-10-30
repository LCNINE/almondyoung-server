import { staffClientOf, type JwtPayload } from '@app/authorization';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** 관리 API 를 부른 사람. 규칙 판정(내 권한·나 자신)과 변경 이력에 같은 값을 쓴다. */
export interface IamActor {
  readonly userId: string;
  readonly loginId: string | null;
  readonly roles: readonly string[];
  readonly userAgent: string | null;
  readonly requestId: string | null;
  /** 관리자 화면 프록시가 넘긴 직원 단말 주소(없으면 null). */
  readonly ip: string | null;
  /** 토큰 테넌트. 이 클레임 전에 나간 토큰에는 없다. */
  readonly tenantId?: string;
}

const header = (request: FastifyRequest, name: string): string | null => {
  const value = request.headers[name];
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 500) : null;
};

export function actorFrom(request: FastifyRequest & { user: JwtPayload }): IamActor {
  return {
    userId: request.user.id,
    loginId: request.user.login_id ?? null,
    roles: request.user.roles ?? [],
    userAgent: header(request, 'user-agent'),
    requestId: header(request, 'x-request-id'),
    ip: staffClientOf(request).claimedIp,
    tenantId: request.user.tenant,
  };
}

export const CurrentIamActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): IamActor =>
    actorFrom(context.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>()),
);
