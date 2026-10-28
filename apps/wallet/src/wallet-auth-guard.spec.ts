import {
  enforcedPermissionProvidersForTesting,
  JwtAuthGuard,
  PermissionGuard,
  RequirePermission,
} from '@app/authorization';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { WalletAdminAuth } from './wallet-admin-auth.decorator';
import { AuthenticatedRequest, WalletAuthGuard } from './wallet-auth.guard';

class Routes {
  @WalletAdminAuth()
  @RequirePermission('payment.payment.read')
  adminRead(): void {}

  merchantCall(): void {}
}

/** 공용 JWT 전략이 남기는 모양(`userId`·`sub`). 토큰이 없으면 인증 실패로 본다. */
const jwt = (roles: string[]): Pick<JwtAuthGuard, 'canActivate'> => ({
  canActivate: (context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.headers.authorization) return false;
    request.user = { userId: 'u1', sub: 'u1', roles };
    return true;
  },
});

const contextFor = (handler: keyof Routes, authorization?: string): ExecutionContext => {
  const request: AuthenticatedRequest = { headers: authorization ? { authorization } : {}, url: '/x' };
  const context = new ExecutionContextHost([request, {}], Routes, Routes.prototype[handler]);
  context.setType('http');
  return context;
};

// 라이브(enforce)와 같은 권한 가드 — 앱에서 WalletAuthGuard 다음 전역 가드다.
const permissionGuard = (byRole: Readonly<Record<string, readonly string[]>>): PermissionGuard => {
  const guard = enforcedPermissionProvidersForTesting(byRole)
    .map((provider): unknown => ('useValue' in provider ? provider.useValue : undefined))
    .find((value): value is PermissionGuard => value instanceof PermissionGuard);
  if (!guard) throw new Error('PermissionGuard provider missing');
  return guard;
};

/** 앱의 전역 가드 순서(WalletAuthGuard → PermissionGuard)대로 돌린다. */
async function admit(roles: string[], authorization?: string): Promise<boolean> {
  const context = contextFor('adminRead', authorization);
  const authenticated = await new WalletAuthGuard(jwt(roles), new Reflector()).canActivate(context);
  return authenticated && permissionGuard({ cs: ['payment.payment.read'], intern: [] }).canActivate(context);
}

describe('WalletAuthGuard admin path', () => {
  it('rejects an admin route without a valid jwt with 401', async () => {
    await expect(admit(['cs'])).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authenticates without comparing roles; the permission guard answers 403 for a role without the permission', async () => {
    const guard = new WalletAuthGuard(jwt(['intern']), new Reflector());
    await expect(guard.canActivate(contextFor('adminRead', 'Bearer t'))).resolves.toBe(true);

    const denied = admit(['intern'], 'Bearer t');
    await expect(denied).rejects.toBeInstanceOf(ForbiddenException);
    await expect(denied).rejects.toMatchObject({
      response: { message: 'Permission required', requiredPermissions: ['payment.payment.read'] },
    });
  });

  it('admits a role that holds the route permission, whatever its name', async () => {
    await expect(admit(['cs'], 'Bearer t')).resolves.toBe(true);
  });

  it('keeps the merchant key path untouched', async () => {
    const guard = new WalletAuthGuard(jwt(['admin']), new Reflector());
    await expect(guard.canActivate(contextFor('merchantCall', 'Bearer not-the-key'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
