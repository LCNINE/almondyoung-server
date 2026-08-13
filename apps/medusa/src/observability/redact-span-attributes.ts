import { maskConnectionStrings } from './mask-secrets';

/**
 * 점은 있지만 값이 민감한 키. 삭제하지 않고 값만 마스킹한다.
 */
const SENSITIVE_DOTTED_KEYS = new Set(['db.connection_string']);

/**
 * 점이 있지만 원시 헤더 값을 담도록 설계된 OTel semconv 속성 그룹.
 * `http.request.header.authorization` 처럼 점 규칙을 그냥 통과하므로 별도로 막는다.
 * 오늘 Medusa 는 이 경로를 쓰지 않지만(원시 스프레드를 쓴다), headersToSpanAttributes
 * 를 켜는 설정 변경이나 버전업 한 번이면 조용히 뚫린다 — "모르는 것은 내보내지 않는다"
 * 는 이 모듈의 전제가 깨지는 지점이라 미리 막는다.
 */
const HEADER_CAPTURE_PREFIXES = ['http.request.header.', 'http.response.header.'];

/**
 * span 속성에서 자격증명을 제거한다.
 *
 * Medusa v2.13.4 는 HTTP span 에 `...req.headers` 를 필터 없이 스프레드한다
 * (packages/medusa/src/instrumentation/index.ts). 그 결과 authorization·cookie 를
 * 포함한 요청 헤더 전량이 span 속성이 된다. 이들은 점이 없다(`accept-encoding`, `authorization`).
 *
 * 점 네임스페이스 규칙: OTel semconv 의 메트릭 속성(`http.route`, `db.system`)은 점이 있다.
 * 이 차이를 규칙으로 삼으면 열거형 blocklist 와 달리 Medusa 가 새 헤더를 흘려도
 * 자동으로 막힌다. 다만 OTel 이 공식 제공하는 헤더 캡처 semconv (`http.request.header.<name>`)
 * 도 점이 있으므로, 이들을 명시적으로 차단한다.
 *
 * 헤더 유래 속성(점 없거나 헤더 캡처 프리픽스)은 `[REDACTED]` 로 남기지 않고 삭제한다.
 * 값이 필요 없는데 남기면 span 속성 카디널리티만 늘어난다.
 */
export function redactSpanAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attributes)) {
    // 점 없는 키는 건너뜀 (Medusa 의 원시 헤더 스프레드)
    if (!key.includes('.')) {
      continue;
    }

    // 헤더 캡처 semconv 프리픽스는 점이 있어도 삭제
    if (HEADER_CAPTURE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }

    // 민감한 dotted 키는 값 마스킹
    if (SENSITIVE_DOTTED_KEYS.has(key) && typeof value === 'string') {
      redacted[key] = maskConnectionStrings(value);
      continue;
    }

    // 그 외 semconv 속성은 통과
    redacted[key] = value;
  }

  return redacted;
}
