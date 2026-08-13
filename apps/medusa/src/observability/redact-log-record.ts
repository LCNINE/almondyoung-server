import { maskConnectionStrings } from './mask-secrets';

export interface RedactableLogRecord {
  body?: unknown;
  attributes?: Record<string, unknown>;
}

/**
 * 재귀 스크럽의 최대 깊이.
 *
 * 로그 페이로드가 매우 깊게 중첩돼 있으면 순회 비용이 커진다. 그 외에도 악의적이거나
 * 버그가 있는 상향 데이터가 매우 깊은 구조(또는 순환 구조)를 만들 수 있다.
 * 이 깊이를 넘으면 플레이스홀더를 반환해 깊은 곳의 비밀번호가 평문으로 유출되는 것을 막는다.
 *
 * 현실적인 로그 페이로드는 이 깊이를 절대 초과하지 않는다 (스택트레이스, 에러 메시지 등은
 * 거의 항상 문자열이다). 초과하는 경우는 데이터 형태가 예기치 않은 것이며, 그런 경우
 * 신중함을 택한다.
 */
const MAX_REDACTION_DEPTH = 8;

/**
 * 평면 객체인지 판정한다.
 *
 * `Object.prototype` 또는 `null` 프로토타입을 가진 객체만 재귀 처리한다.
 * Error/Date/Map/RegExp 등 exotic 객체는 프로토타입이 다르므로 통과시킨다.
 * Exotic 객체를 Object.entries 로 순회하면 비열거형 속성이 손실돼
 * 로그 정보가 소리 없이 사라진다 (Error.stack/message 등).
 */
function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 값을 재귀적으로 스크럽한다.
 *
 * 문자열 → `maskConnectionStrings` 적용
 * 배열 → 각 원소를 재귀 스크럽한 새 배열 반환
 * 평면 객체 → 각 값을 재귀 스크럽한 새 객체 반환 (키는 보존)
 * 그 외(number/boolean/null/Error/Date/Map/RegExp 등) → 그대로 반환
 *
 * 순환 참조와 깊이 초과는 플레이스홀더를 반환해 안전성과 보안을 모두 보장한다.
 */
function redactValue(
  value: unknown,
  depth: number,
  visited: WeakSet<object>,
): unknown {
  // 깊이 제한 초과 — 플레이스홀더를 반환해 깊은 곳의 비밀번호 평문 유출을 막는다
  if (depth > MAX_REDACTION_DEPTH) {
    return '[Depth limit exceeded]';
  }

  // 문자열 스크럽
  if (typeof value === 'string') {
    return maskConnectionStrings(value);
  }

  // 비-컨테이너 타입은 그대로 반환
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // 순환 참조 감지 — 평문으로 재유출하지 않도록 플레이스홀더를 반환한다
  if (visited.has(value)) {
    return '[Circular]';
  }

  // 배열만 재귀 처리
  if (Array.isArray(value)) {
    visited.add(value);
    const result = value.map((item) => redactValue(item, depth + 1, visited));
    visited.delete(value);
    return result;
  }

  // 평면 객체만 재귀 처리. 그 외 exotic 객체(Error/Date/Map/RegExp 등)는
  // 그대로 통과시킨다. 현재 로거(otel-logger.js)는 Error 를
  // attribute 로 넣기 전에 err.stack/err.message 문자열로 변환하므로
  // 실제 경로에서는 문제가 없다. Exotic 객체를 재귀하면
  // Object.entries 로 인해 비열거형 속성이 손실되고 결과적으로
  // {} 나 mangled 내용이 되어 로그 정보가 소리 없이 사라진다.
  if (isPlainObject(value)) {
    visited.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = redactValue(val, depth + 1, visited);
    }
    visited.delete(value);
    return result;
  }

  // 평면 객체가 아닌 모든 객체(Error/Date/Map/RegExp/etc)는 그대로 반환
  return value;
}

/**
 * 로그 레코드에서 자격증명을 제거한다.
 *
 * span 과 규칙이 다르다. span 은 키가 문제(`authorization` 이라는 키 자체)지만
 * 로그는 값이 문제다 — `exception.message` 나 스택트레이스 *문자열 안에* 접속 URL 이
 * 박힌다 (Postgres 연결 실패 메시지의 흔한 형태). 키를 지워서는 막을 수 없다.
 *
 * 따라서 "점 없는 키 삭제" 규칙은 적용하지 않는다. 그 규칙은 헤더 스프레드를 겨냥한
 * 것이고 로그에는 헤더 스프레드가 없다. 키는 전부 보존하고 값만 스크럽한다.
 *
 * body 와 attributes 의 값은 재귀적으로 스크럽된다. 깊이 제한과 순환 참조 방어를
 * 포함하므로 관측 코드가 서비스를 크래시하지 않는다.
 */
export function redactLogRecordFields(record: RedactableLogRecord): {
  body: unknown;
  attributes: Record<string, unknown>;
} {
  const visited = new WeakSet<object>();
  const attributes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    attributes[key] = redactValue(value, 0, visited);
  }

  return {
    body: redactValue(record.body, 0, visited),
    attributes,
  };
}
