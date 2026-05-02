import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_ENVELOPE_KEY = 'skip_response_envelope';

/**
 * 컨트롤러/핸들러에 부착하면 ResponseInterceptor 의 `{success, data}` 래핑을 건너뛴다.
 * RFC 6749/8414/OIDC Discovery 처럼 평면 응답이 표준에 의해 강제되는 라우트에 사용한다.
 */
export const SkipResponseEnvelope = (): ClassDecorator & MethodDecorator =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true);
