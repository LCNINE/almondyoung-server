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
    // 에러가 있거나 user가 없어도 통과, user만 반환 (없으면 null)
    return user || null;
  }

  canActivate(context: ExecutionContext) {
    // 토큰 파싱 시도
    return super.canActivate(context);
  }
}
