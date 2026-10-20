import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AuthzShadowRecorder } from '../services/authz-shadow.recorder';
import { methodOf, rawResponseOf } from '../services/request-identity';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';

/**
 * 전역 가드 «맨 앞»에 둔다. 결과에 관여하지 않고(항상 true) 라우트 요구사항을 기록기에 넘긴다.
 *
 * 맨 앞이어야 하는 이유: 뒤의 가드가 거부하면 Nest 는 다음 가드를 부르지 않는다. 그러면 «기존은
 * 거부, 새 판정은 허용»(새 체계가 더 넓은 경우)을 영영 못 본다. 사용자 정보는 이 시점에 없어도 된다 —
 * 판정은 응답이 끝날 때 한다.
 */
@Injectable()
export class AuthzObserverGuard implements CanActivate {
  constructor(
    private readonly resolver: RouteRequirementResolver,
    @Inject(AuthzShadowRecorder) private readonly recorder: Pick<AuthzShadowRecorder, 'observe'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const { requirement, path } = this.resolver.resolve(context);
    if (requirement.kind === 'open') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<object>();
    const response = rawResponseOf(http.getResponse<unknown>());
    if (response) this.recorder.observe(request, response, `${methodOf(request)} ${path}`, requirement);
    return true;
  }
}
