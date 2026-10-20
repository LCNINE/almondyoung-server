import { Injectable, CanActivate, ExecutionContext, Inject, Optional, Type } from '@nestjs/common';
import { PermissionAuthority } from '../services/permission-authority';

@Injectable()
export class MasterRoleGuard implements CanActivate {
  /** 새 권한 판정으로 넘어간 서비스의 권한 라우트에서는 물러난다. */
  constructor(@Optional() @Inject(PermissionAuthority) private readonly authority?: Pick<PermissionAuthority, 'decides'>) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.authority?.decides(context)) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !Array.isArray(user.roles)) return false;
    return user.roles.includes('master');
  }
}

export function RolesGuard(...allowed: string[]): Type<CanActivate> {
  @Injectable()
  class Guard implements CanActivate {
    /** 새 권한 판정으로 넘어간 서비스의 권한 라우트에서는 물러난다. */
    constructor(@Optional() @Inject(PermissionAuthority) private readonly authority?: Pick<PermissionAuthority, 'decides'>) {}

    canActivate(context: ExecutionContext): boolean {
      if (this.authority?.decides(context)) return true;
      const request = context.switchToHttp().getRequest();
      const user = request.user;
      if (!user || !Array.isArray(user.roles)) return false;
      return user.roles.some((role: string) => allowed.includes(role));
    }
  }
  return Guard;
}
