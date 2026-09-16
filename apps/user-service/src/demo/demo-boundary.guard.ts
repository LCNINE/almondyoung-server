import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDemoBlockedAuthPath } from './demo-boundary';

@Injectable()
export class DemoBoundaryGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('APP_STAGE') !== 'demo' || context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<{ url: string }>();
    if (isDemoBlockedAuthPath(request.url)) {
      throw new NotFoundException('시연 환경에서는 준비된 계정으로 로그인해 주세요.');
    }
    return true;
  }
}
