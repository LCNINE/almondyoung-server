import { Injectable, CanActivate, ExecutionContext, Type } from '@nestjs/common';

@Injectable()
export class MasterRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !Array.isArray(user.roles)) return false;
    return user.roles.includes('master');
  }
}

export function RolesGuard(...allowed: string[]): Type<CanActivate> {
  @Injectable()
  class Guard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest();
      const user = request.user;
      if (!user || !Array.isArray(user.roles)) return false;
      return user.roles.some((role: string) => allowed.includes(role));
    }
  }
  return Guard;
}
