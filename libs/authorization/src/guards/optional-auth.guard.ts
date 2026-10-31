import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ServedTenantGate } from '../services/served-tenant-gate';

/**
 * Optional Authentication Guard
 * 토큰이 있으면 파싱하고, 없거나 유효하지 않아도 통과시킴
 * @User() 데코레이터로 userId를 받을 수 있음 (없으면 null)
 *
 * 토큰이 왔으면 공유 서비스 문을 지난다 — 이 가드는 라우트 가드라 전역 `PermissionGuard` 뒤에서 토큰을 읽으므로,
 * 거기서 못 본 토큰 테넌트를 여기서 본다. 문은 `PermissionModule.forRoot` 가 주고, 없는 앱(문 없음)은 건너뛴다.
 */
@Injectable()
export class OptionalAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() private readonly tenantGate?: ServedTenantGate) {
    super();
  }

  handleRequest(err: any, user: any) {
    return user || null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 토큰 파싱 시도, 실패해도 통과
    try {
      await super.canActivate(context);
    } catch {
      // 토큰이 없거나 유효하지 않아도 무시
    }
    this.tenantGate?.admitToken(context.switchToHttp().getRequest<object>(), context.getHandler().name);
    return true;
  }
}
