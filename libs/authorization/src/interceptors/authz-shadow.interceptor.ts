import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthzShadowRecorder } from '../services/authz-shadow.recorder';

/** 인터셉터까지 왔다 = 전역·컨트롤러·라우트 가드를 전부 통과했다. 그 사실만 표시한다. */
@Injectable()
export class AuthzShadowInterceptor implements NestInterceptor {
  constructor(private readonly recorder: AuthzShadowRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') this.recorder.markPassed(context.switchToHttp().getRequest<object>());
    return next.handle();
  }
}
