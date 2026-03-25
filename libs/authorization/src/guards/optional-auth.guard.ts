import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional Authentication Guard
 * 토큰이 있으면 파싱하고, 없거나 유효하지 않아도 통과시킴
 * @User() 데코레이터로 userId를 받을 수 있음 (없으면 null)
 */
@Injectable()
export class OptionalAuthGuard extends AuthGuard('jwt') {
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
    return true;
  }
}
