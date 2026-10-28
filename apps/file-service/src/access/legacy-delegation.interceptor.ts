import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtPayload } from '../shared/types/jwt-payload.interface';
import { delegationOf } from './service-delegation';

/**
 * 옛 표기 위임 토큰으로 들어온 요청을 한 줄씩 남긴다 — 보내는 쪽이 모두 새 표기로 옮겼는지(옛 표기 0건)를 로그로 보고
 * 옛 표기를 거절하기 위해서다. 업로드·소유자 경로처럼 판정 지점을 지나지 않는 요청까지 세려고 전역에 둔다.
 */
@Injectable()
export class LegacyDelegationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LegacyDelegationInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
      const delegation = user ? delegationOf(user) : null;
      if (delegation?.notation === 'legacy') {
        this.logger.log(
          JSON.stringify({ event: 'authz_legacy_delegation', service: 'file-service', delegate: delegation.delegate }),
        );
      }
    }
    return next.handle();
  }
}
