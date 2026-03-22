import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class MasterRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !Array.isArray(user.roles)) return false;
    return user.roles.includes('master');
  }
}
