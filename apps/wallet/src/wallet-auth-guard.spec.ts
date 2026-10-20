import { JwtAuthGuard, PermissionAuthority, RequirePermission, RouteRequirementResolver } from '@app/authorization';
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

const authority = (enforce: boolean) =>
  new PermissionAuthority(new RouteRequirementResolver(new Reflector()), {
    service: 'wallet',
    enforce,
    refreshIntervalMs: 30_000,
    retryBaseMs: 1_000,
    summaryIntervalMs: 300_000,
  });

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

describe('WalletAuthGuard admin path', () => {
  it('skips the role check on an admin route once enforced', async () => {
    const guard = new WalletAuthGuard(jwt(['intern']), new Reflector(), authority(true));
    await expect(guard.canActivate(contextFor('adminRead', 'Bearer t'))).resolves.toBe(true);
  });

  it('requires the admin role while off', async () => {
    const guard = new WalletAuthGuard(jwt(['intern']), new Reflector(), authority(false));
    await expect(guard.canActivate(contextFor('adminRead', 'Bearer t'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still requires a valid jwt on an admin route once enforced', async () => {
    const guard = new WalletAuthGuard(jwt(['admin']), new Reflector(), authority(true));
    await expect(guard.canActivate(contextFor('adminRead'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps the merchant key path untouched once enforced', async () => {
    const guard = new WalletAuthGuard(jwt(['admin']), new Reflector(), authority(true));
    await expect(guard.canActivate(contextFor('merchantCall', 'Bearer not-the-key'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
