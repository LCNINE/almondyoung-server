# Medusa OTel 자격증명 유출 차단 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 가 OTel span/로그로 내보내는 요청 헤더와 DB 접속 문자열에서 자격증명을 제거해, Grafana Cloud 로 실값이 나가지 않게 한다.

**Architecture:** 정리 규칙을 의존성 없는 순수 함수 3 개로 분리하고, exporter 래퍼 2 개가 그것을 호출해 위임한다. `apps/medusa/instrumentation.ts` 에서 기존 exporter 를 래퍼로 감싸는 것이 전체 배선이다. Alloy(collector) 에 같은 규칙을 2 차 방어선으로 추가한다.

**Tech Stack:** TypeScript, OpenTelemetry JS SDK (`@opentelemetry/*` 0.200.0), Jest + `@swc/jest`, Grafana Alloy (OTTL), GitHub Actions

## Global Constraints

- 설계 근거는 `docs/superpowers/specs/2026-08-14-medusa-otel-credential-redaction-design.md` 다. 충돌하면 스펙이 우선한다.
- **신규 npm 의존성을 추가하지 않는다.** exporter 래퍼는 OTel 타입을 import 하지 않고 구조적 타입(structural typing)으로 맞춘다. `@opentelemetry/sdk-trace-base` 는 `apps/medusa/package.json` 의 직접 의존성이 아니며, 이번 작업으로 추가하지 않는다.
- 계측은 끄지 않는다. `instrument: { http: true, workflows: true, query: true, db: true }` 를 그대로 유지한다.
- 테스트 파일은 반드시 `apps/medusa/src/**/__tests__/**/*.unit.spec.ts` 경로·이름을 따른다. Medusa jest 의 `testMatch` 가 이 패턴만 잡는다.
- 루트 `npm run type-check` 와 루트 `npx jest` 는 `apps/medusa` 를 제외하므로 이 작업의 검증에 쓸 수 없다. 검증은 `npm run test:medusa` 로만 한다.
- 마이그레이션 0 건. `db:generate` / `db:migrate` 를 호출하지 않는다.
- 커밋 메시지는 한국어 본문 + `Claude-Session:` 트레일러를 붙인다 (저장소 관례).
- **모든 명령은 저장소 루트에서 실행한다.** `cd apps/medusa` 로 이동하는 스텝이 있으면 다음 스텝 전에 루트로 돌아온다 (셸 작업 디렉토리가 호출 간에 유지되므로, 루트 스크립트인 `npm run test:medusa` 가 엉뚱한 위치에서 돌면 실패한다).

---

### Task 1: `maskConnectionStrings` 순수 함수

URL 형태 접속 문자열에서 비밀번호 구간만 `[REDACTED]` 로 치환한다. span 과 로그 양쪽이 공유하는 유일한 공용 조각이다.

**Files:**
- Create: `apps/medusa/src/observability/mask-secrets.ts`
- Test: `apps/medusa/src/observability/__tests__/mask-secrets.unit.spec.ts`

**Interfaces:**
- Consumes: 없음 (의존성 0)
- Produces: `maskConnectionStrings(text: string): string`

- [ ] **Step 1: Medusa 의존성 설치**

이 워크트리에는 `apps/medusa/node_modules` 가 없다. jest 를 돌리려면 먼저 설치가 필요하다.
`--prefix` 를 써서 셸 작업 디렉토리를 루트에 유지한다.

```bash
npm --prefix apps/medusa ci
```

기대: 설치 완료. 수 분 걸린다. 이미 설치돼 있으면 건너뛴다.

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/medusa/src/observability/__tests__/mask-secrets.unit.spec.ts`:

```typescript
import { maskConnectionStrings } from '../mask-secrets';

describe('maskConnectionStrings', () => {
  it('접속 문자열의 비밀번호만 치환하고 나머지는 보존한다', () => {
    expect(maskConnectionStrings('postgresql://postgres:s3cr3t@localhost:5432/medusa')).toBe(
      'postgresql://postgres:[REDACTED]@localhost:5432/medusa',
    );
  });

  it('비밀번호가 없는 URL 은 바꾸지 않는다', () => {
    expect(maskConnectionStrings('postgresql://localhost:5432/medusa')).toBe(
      'postgresql://localhost:5432/medusa',
    );
  });

  it('사용자명이 비어 있어도 비밀번호를 치환한다', () => {
    expect(maskConnectionStrings('redis://:p4ss@localhost:6379')).toBe(
      'redis://:[REDACTED]@localhost:6379',
    );
  });

  it('한 문자열 안의 여러 접속 문자열을 모두 치환한다', () => {
    const input =
      'primary=postgresql://a:pw1@localhost:5432/d1 replica=postgresql://b:pw2@127.0.0.1:5432/d2';
    expect(maskConnectionStrings(input)).toBe(
      'primary=postgresql://a:[REDACTED]@localhost:5432/d1 replica=postgresql://b:[REDACTED]@127.0.0.1:5432/d2',
    );
  });

  it('에러 메시지 안에 박힌 접속 문자열도 치환한다', () => {
    const input =
      'connection to server failed: postgresql://postgres:s3cr3t@localhost:5432/medusa (timeout)';
    expect(maskConnectionStrings(input)).toBe(
      'connection to server failed: postgresql://postgres:[REDACTED]@localhost:5432/medusa (timeout)',
    );
  });

  it('자격증명이 없는 URL 과 평문은 그대로 둔다', () => {
    expect(maskConnectionStrings('https://example.com/path')).toBe('https://example.com/path');
    expect(maskConnectionStrings('접속 정보 없음')).toBe('접속 정보 없음');
  });

  it('빈 문자열을 처리한다', () => {
    expect(maskConnectionStrings('')).toBe('');
  });

  it('비밀번호에 포함된 @ 를 전부 치환한다', () => {
    expect(maskConnectionStrings('postgresql://user:p@ssword@localhost:5432/db')).toBe(
      'postgresql://user:[REDACTED]@localhost:5432/db',
    );
  });

  it('쿼리스트링의 @ 를 삼키지 않는다', () => {
    expect(maskConnectionStrings('postgresql://u:p@localhost/db?opt=a@b')).toBe(
      'postgresql://u:[REDACTED]@localhost/db?opt=a@b',
    );
  });

  it('이미 치환된 문자열에 다시 적용해도 결과가 같다 (멱등)', () => {
    const original = 'postgresql://postgres:s3cr3t@localhost:5432/medusa';
    const masked = maskConnectionStrings(original);
    const reMasked = maskConnectionStrings(masked);
    expect(reMasked).toBe(masked);
  });

  // 아래 두 케이스는 과잉 마스킹이다. 고치지 말 것 — 좁히면 해당 문자가 든
  // 비밀번호에서 다시 샌다. under-mask(유출)보다 over-mask(정보 손실)를 택한 결과다.
  it('경로 없는 URL 뒤에 구분자 없이 @ 가 오면 과잉 마스킹된다 (의도된 트레이드오프)', () => {
    expect(maskConnectionStrings('postgresql://user:pass@localhost:5432,ops@127.0.0.1:1')).toBe(
      'postgresql://user:[REDACTED]@127.0.0.1:1',
    );
  });

  it('경로가 있으면 과잉 마스킹되지 않는다 — 실제 접속 문자열의 형태다', () => {
    expect(
      maskConnectionStrings('postgresql://user:pass@localhost:5432/medusa?sslmode=require ops@company.com'),
    ).toBe('postgresql://user:[REDACTED]@localhost:5432/medusa?sslmode=require ops@company.com');
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
npm run test:medusa
```

기대: FAIL — `Cannot find module '../mask-secrets'`

- [ ] **Step 4: 최소 구현 작성**

`apps/medusa/src/observability/mask-secrets.ts`:

```typescript
/**
 * URL 형태 접속 문자열의 자격증명 구간에서 비밀번호만 치환한다.
 *
 * 스킴·사용자명·호스트·포트·경로는 보존한다 — 어느 호스트의 어느 논리 DB 에 붙다
 * 실패했는지가 디버깅에 실제로 쓰이기 때문이다. 사용자명이 비어 있는 형태
 * (`redis://:pw@host`) 도 처리한다.
 *
 * 비밀번호에 포함된 `@` 도 전부 치환 대상에 포함된다 — 쿼리스트링의 `@` 같은
 * URL 본문 뒷부분의 문자는 보존한다. 대신 공백이 포함된 URL(RFC 위반)은 계약 밖이다.
 *
 * ### 과잉 마스킹 트레이드오프 (의도된 동작)
 *
 * 정규식은 `[^\s/?#]*` 로 탐욕적으로 매칭해 마지막 `@` 를 찾는다. 경로가 없는 URL 에서
 * 비밀번호 뒤에 구분자 없이 다른 `@` 가 오면, 그 `@` 까지 모두 `[REDACTED]` 로 덮는다.
 * 예: `postgresql://user:pass@localhost:5432,ops@127.0.0.1:1` → `postgresql://user:[REDACTED]@127.0.0.1:1`
 *
 * 이것을 좁혀서(`[^\s/?#,()]*` 같이) 막으면 `,` `(` `)` 가 든 비밀번호에서 다시 샌다
 * (RFC 3986 상 이 문자들은 userinfo 에 인코딩 없이 들어갈 수 있다). 보안에서는 under-mask(유출)
 * 보다 over-mask(정보 손실)를 택한다.
 *
 * 실제 영향은 없다 — 이 저장소의 접속 문자열(`deployments/lcnine/services/infra/shared.ts` 의
 * `dbUrl()`)은 항상 경로(예: `/medusa`)를 포함하고, `/` 가 탐욕적 매칭을 끊는다. 유일한
 * 무경로 URL 인 valkey 는 비밀번호가 없다.
 *
 * 이미 치환된 문자열에 다시 적용해도 결과가 같다 (멱등).
 */
const CONNECTION_STRING_CREDENTIALS = /:\/\/([^:/?#\s@]*):([^\s/?#]*)@/g;

export function maskConnectionStrings(text: string): string {
  return text.replace(CONNECTION_STRING_CREDENTIALS, '://$1:[REDACTED]@');
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

```bash
npm run test:medusa
```

기대: PASS — `mask-secrets.unit.spec.ts` 의 12 개 케이스 전부 통과. 기존 spec 도 계속 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/observability/mask-secrets.ts apps/medusa/src/observability/__tests__/mask-secrets.unit.spec.ts
git commit -F - <<'EOF'
feat(medusa): 접속 문자열 비밀번호 마스킹 순수 함수를 추가한다

span 과 로그 양쪽이 공유하는 유일한 공용 조각이다. 스킴·사용자·호스트는
보존하고 비밀번호만 치환한다 — 어느 DB 에 붙다 실패했는지가 디버깅에
쓰이기 때문이다. 멱등이라 collector 에서 다시 적용해도 안전하다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

### Task 2: `redactSpanAttributes` 순수 함수

span 속성에서 헤더 유래 키를 삭제하고 OTel 헤더 캡처 semconv 를 차단하며 `db.connection_string` 을 마스킹한다.

**Files:**
- Create: `apps/medusa/src/observability/redact-span-attributes.ts`
- Test: `apps/medusa/src/observability/__tests__/redact-span-attributes.unit.spec.ts`

**Interfaces:**
- Consumes: `maskConnectionStrings(text: string): string` (Task 1)
- Produces: `redactSpanAttributes(attributes: Record<string, unknown>): Record<string, unknown>`

**규칙 테이블** (Medusa + OTel 정책의 교집합):
| 키 형태 | 규칙 | 이유 |
|--------|------|------|
| `authorization`, `cookie`, `accept-*` (점 X) | 삭제 | Medusa 의 원시 헤더 스프레드 |
| `http.request.header.*`, `http.response.header.*` (점 O, 헤더 캡처) | 삭제 | OTel 공식 헤더 캡처 semconv, 원시 값 담음 |
| `http.route`, `http.method`, `db.system` (점 O, 메트릭) | 통과 | OTel 표준 속성 |
| `db.connection_string` | 마스킹 | 점이 있는 민감 키, 삭제 아님 |

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/medusa/src/observability/__tests__/redact-span-attributes.unit.spec.ts`:

```typescript
import { redactSpanAttributes } from '../redact-span-attributes';

describe('redactSpanAttributes', () => {
  it('점이 없는 키(헤더 유래)를 삭제한다', () => {
    const result = redactSpanAttributes({
      authorization: 'Bearer eyJhbGciOi',
      cookie: 'session=abc',
      'accept-encoding': 'gzip',
      'x-publishable-api-key': 'pk_123',
    });
    expect(result).toEqual({});
  });

  it('점이 있는 semconv 속성은 통과시킨다', () => {
    const attributes = {
      'http.route': '/store/products',
      'http.method': 'GET',
      'db.system': 'postgresql',
      'workflow.step.idempotency_key': 'abc',
    };
    expect(redactSpanAttributes(attributes)).toEqual(attributes);
  });

  it('db.connection_string 의 비밀번호를 마스킹한다', () => {
    const result = redactSpanAttributes({
      'db.connection_string': 'postgresql://postgres:s3cr3t@localhost:5432/medusa',
    });
    expect(result).toEqual({
      'db.connection_string': 'postgresql://postgres:[REDACTED]@localhost:5432/medusa',
    });
  });

  it('헤더와 semconv 가 섞여 있으면 헤더만 걸러낸다', () => {
    const result = redactSpanAttributes({
      authorization: 'Bearer x',
      'http.route': '/admin/orders',
    });
    expect(result).toEqual({ 'http.route': '/admin/orders' });
  });

  it('db.connection_string 이 문자열이 아니면 그대로 둔다', () => {
    expect(redactSpanAttributes({ 'db.connection_string': 42 })).toEqual({
      'db.connection_string': 42,
    });
  });

  it('빈 객체를 처리한다', () => {
    expect(redactSpanAttributes({})).toEqual({});
  });

  it('입력 객체를 변형하지 않는다', () => {
    const input = { authorization: 'Bearer x', 'http.route': '/a' };
    redactSpanAttributes(input);
    expect(input).toEqual({ authorization: 'Bearer x', 'http.route': '/a' });
  });

  it('http.request.header.* semconv 를 삭제한다', () => {
    const result = redactSpanAttributes({
      'http.request.header.authorization': ['Bearer eyJhbGciOi'],
      'http.request.header.cookie': ['session=abc'],
      'http.route': '/store/products',
    });
    expect(result).toEqual({ 'http.route': '/store/products' });
  });

  it('http.response.header.* semconv 를 삭제한다', () => {
    const result = redactSpanAttributes({
      'http.response.header.set-cookie': ['sessionId=xyz'],
      'http.status_code': 200,
    });
    expect(result).toEqual({ 'http.status_code': 200 });
  });

  it('프리픽스 규칙이 http.route/http.method 는 통과시킨다', () => {
    const attributes = {
      'http.route': '/admin/orders',
      'http.method': 'POST',
      'http.request.header.authorization': ['Bearer x'],
    };
    const result = redactSpanAttributes(attributes);
    expect(result).toEqual({
      'http.route': '/admin/orders',
      'http.method': 'POST',
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npm run test:medusa
```

기대: FAIL — `Cannot find module '../redact-span-attributes'`

- [ ] **Step 3: 최소 구현 작성 (수정됨)**

`apps/medusa/src/observability/redact-span-attributes.ts`:

```typescript
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npm run test:medusa
```

기대: PASS — 10 개 케이스 전부 통과 (7 + 3 new: http.request.header, http.response.header, prefix 오버 검증).

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/observability/redact-span-attributes.ts apps/medusa/src/observability/__tests__/redact-span-attributes.unit.spec.ts
git commit -F - <<'EOF'
feat(medusa): span 속성에서 헤더 유래 자격증명을 제거한다

Medusa 가 요청 헤더를 통째로 스프레드하므로 열거형 blocklist 로는 다음 버전에서
또 샌다. OTel semconv 는 전부 점 네임스페이스이고 원시 헤더명은 점이 없다는 차이를
규칙으로 삼아, 모르는 키는 기본적으로 내보내지 않는다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

### Task 3: `redactLogRecordFields` 순수 함수

로그는 키가 아니라 **값**이 문제다. `exception.message` 나 스택트레이스 문자열 *안에* 접속 URL 이 박힌다. 키 삭제로는 막을 수 없으므로 값을 스크럽한다.

**Files:**
- Create: `apps/medusa/src/observability/redact-log-record.ts`
- Test: `apps/medusa/src/observability/__tests__/redact-log-record.unit.spec.ts`

**Interfaces:**
- Consumes: `maskConnectionStrings(text: string): string` (Task 1)
- Produces:
  - `interface RedactableLogRecord { body?: unknown; attributes?: Record<string, unknown> }`
  - `redactLogRecordFields(record: RedactableLogRecord): { body: unknown; attributes: Record<string, unknown> }`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/medusa/src/observability/__tests__/redact-log-record.unit.spec.ts`:

```typescript
import { redactLogRecordFields } from '../redact-log-record';

describe('redactLogRecordFields', () => {
  it('body 문자열 안의 접속 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'connect failed: postgresql://postgres:s3cr3t@localhost:5432/medusa',
      attributes: {},
    });
    expect(result.body).toBe('connect failed: postgresql://postgres:[REDACTED]@localhost:5432/medusa');
  });

  it('문자열 attribute 를 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'error',
      attributes: {
        'exception.message': 'postgresql://postgres:s3cr3t@localhost:5432/medusa 접속 실패',
        'exception.type': 'Error',
      },
    });
    expect(result.attributes).toEqual({
      'exception.message': 'postgresql://postgres:[REDACTED]@localhost:5432/medusa 접속 실패',
      'exception.type': 'Error',
    });
  });

  it('점 없는 키를 삭제하지 않는다 — 로그에는 헤더 스프레드가 없다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { level: 'info', count: 3 },
    });
    expect(result.attributes).toEqual({ level: 'info', count: 3 });
  });

  it('문자열이 아닌 attribute 는 그대로 둔다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { count: 42, enabled: true, missing: null },
    });
    expect(result.attributes).toEqual({ count: 42, enabled: true, missing: null });
  });

  it('문자열이 아닌 body 는 그대로 둔다', () => {
    const result = redactLogRecordFields({ body: { code: 500 }, attributes: {} });
    expect(result.body).toEqual({ code: 500 });
  });

  it('body 와 attributes 가 없어도 처리한다', () => {
    const result = redactLogRecordFields({});
    expect(result.body).toBeUndefined();
    expect(result.attributes).toEqual({});
  });

  it('입력 객체를 변형하지 않는다', () => {
    const input = {
      body: 'postgresql://u:pw@localhost:5432/d',
      attributes: { 'exception.message': 'postgresql://u:pw@localhost:5432/d' },
    };
    redactLogRecordFields(input);
    expect(input.body).toBe('postgresql://u:pw@localhost:5432/d');
    expect(input.attributes['exception.message']).toBe('postgresql://u:pw@localhost:5432/d');
  });

  it('배열 안의 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: ['at foo (postgresql://postgres:s3cr3t@localhost:5432/medusa)', 'at bar'],
      attributes: {},
    });
    expect(result.body).toEqual([
      'at foo (postgresql://postgres:[REDACTED]@localhost:5432/medusa)',
      'at bar',
    ]);
  });

  it('중첩 객체 안의 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: {
        'db.error.detail': {
          dsn: 'postgresql://postgres:s3cr3t@localhost:5432/medusa',
          code: 'CONNECTION_FAILED',
        },
      },
    });
    expect(result.attributes['db.error.detail']).toEqual({
      dsn: 'postgresql://postgres:[REDACTED]@localhost:5432/medusa',
      code: 'CONNECTION_FAILED',
    });
  });

  it('중첩 배열·객체 혼합에서 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: {
        traces: [
          { message: 'postgresql://postgres:s3cr3t@localhost:5432/medusa 접속 실패' },
          { message: 'retry 성공' },
        ],
      },
    });
    expect(result.attributes.traces).toEqual([
      { message: 'postgresql://postgres:[REDACTED]@localhost:5432/medusa 접속 실패' },
      { message: 'retry 성공' },
    ]);
  });

  it('깊이 제한 초과 시 플레이스홀더를 반환하고 평문을 유출하지 않는다', () => {
    // 깊이 9의 중첩 구조 생성 (MAX_REDACTION_DEPTH = 8 을 넘음)
    let deepNested: any = { dsn: 'postgresql://postgres:s3cr3t@localhost:5432/medusa' };
    for (let i = 0; i < 9; i++) {
      deepNested = { nested: deepNested };
    }

    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { data: deepNested },
    });

    // 깊이 제한 초과 시 플레이스홀더가 깊은 곳에 있음
    // 8 단계 중첩 까지는 구조가 유지되고, 9단계에서 플레이스홀더로 대체됨
    const stringified = JSON.stringify(result);
    expect(stringified).toContain('[Depth limit exceeded]');
    // 평문 비밀번호가 결과에 없는지 확인 — 깊이 초과로 스크럽 안 된 dsn 도 없음
    expect(stringified).not.toContain('s3cr3t');
  });

  it('순환 참조는 플레이스홀더로 표현하고 평문을 유출하지 않는다', () => {
    const circular: any = { name: 'error', dsn: 'postgresql://postgres:s3cr3t@localhost:5432/medusa' };
    circular.self = circular; // 자기 자신 참조

    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { error: circular },
    });

    // 순환 참조는 플레이스홀더로 표현됨
    expect((result.attributes.error as any).self).toBe('[Circular]');
    // 첫 참조의 dsn 은 스크럽됨
    expect((result.attributes.error as any).dsn).toBe('postgresql://postgres:[REDACTED]@localhost:5432/medusa');
    // 평문 비밀번호가 결과에 없는지 확인
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
  });

  it('비문자열 스칼라(number, boolean, null)는 여전히 그대로다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: {
        nested: {
          count: 42,
          enabled: true,
          missing: null,
          undef: undefined,
        },
      },
    });
    expect(result.attributes.nested).toEqual({
      count: 42,
      enabled: true,
      missing: null,
      undef: undefined,
    });
  });

  it('입력 불변성이 중첩 구조에서도 유지된다', () => {
    const input = {
      body: ['postgresql://u:pw@localhost/d'],
      attributes: {
        nested: {
          dsn: 'postgresql://u:pw@localhost/d',
        },
      },
    };

    redactLogRecordFields(input);

    // 원본 배열과 객체는 스크럽되지 않은 채로 유지된다
    expect((input.body as any)[0]).toBe('postgresql://u:pw@localhost/d');
    expect(input.attributes.nested['dsn']).toBe('postgresql://u:pw@localhost/d');
  });

  it('Error 인스턴스가 attribute 로 오면 {} 로 바뀌지 않고 보존된다', () => {
    const error = new Error('test error');
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { 'exception.error': error },
    });

    // Error 인스턴스가 그대로 보존됨 (Object.entries 로 재귀하면 {} 가 됨)
    expect(result.attributes['exception.error']).toBe(error);
    expect(result.attributes['exception.error']).toBeInstanceOf(Error);
  });

  it('Date 인스턴스가 attribute 로 오면 보존된다', () => {
    const date = new Date('2026-08-14T10:00:00Z');
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { timestamp: date },
    });

    // Date 인스턴스가 그대로 보존됨
    expect(result.attributes.timestamp).toBe(date);
    expect(result.attributes.timestamp).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npm run test:medusa
```

기대: FAIL — `Cannot find module '../redact-log-record'`

- [ ] **Step 3: 최소 구현 작성 (재귀 스크럽·깊이 제한·순환 참조 방어·exotic 객체 보호 추가됨)**

`apps/medusa/src/observability/redact-log-record.ts`:

```typescript
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
 * 포함하므로 관측 코드가 서비스를 크래시하지 않는다. Exotic 객체는 보호하므로
 * 로그 정보가 소리 없이 손실되지 않는다.
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npm run test:medusa
```

기대: PASS — 16 개 케이스 전부 통과 (7 original + 9 new: 배열/중첩/혼합/깊이제한/순환참조/스칼라/불변성/Error보존/Date보존).

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/observability/redact-log-record.ts apps/medusa/src/observability/__tests__/redact-log-record.unit.spec.ts
git commit -F - <<'EOF'
feat(medusa): 로그 레코드에서 접속 문자열을 스크럽한다

로그는 span 과 규칙이 다르다. 키가 아니라 값이 문제이므로 — 에러 메시지와
스택트레이스 문자열 안에 접속 URL 이 박힌다 — 키는 전부 보존하고 값만 스크럽한다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

### Task 4: exporter 래퍼와 배선

순수 함수를 실제 OTel 파이프라인에 연결한다. 래퍼는 정리하고 위임할 뿐이라 로직이 없다.

**Files:**
- Create: `apps/medusa/src/observability/redacting-span-exporter.ts`
- Create: `apps/medusa/src/observability/redacting-log-exporter.ts`
- Modify: `apps/medusa/instrumentation.ts`

**Interfaces:**
- Consumes: `redactSpanAttributes` (Task 2), `redactLogRecordFields` (Task 3)
- Produces:
  - `class RedactingSpanExporter { constructor(inner: SpanExporterLike) }`
  - `class RedactingLogExporter { constructor(inner: LogRecordExporterLike) }`

- [ ] **Step 1: span exporter 래퍼 작성**

OTel 타입을 import 하지 않는다 (Global Constraints — 신규 의존성 금지). TypeScript 의 구조적 타이핑으로 `SpanExporter` 자리에 그대로 들어간다.

`apps/medusa/src/observability/redacting-span-exporter.ts`:

```typescript
import { redactSpanAttributes } from './redact-span-attributes';

interface ExportResultLike {
  code: number;
  error?: Error;
}

/**
 * `@opentelemetry/sdk-trace-base` 의 SpanExporter 와 구조적으로 호환되는 최소 형태.
 * 타입을 직접 import 하지 않는 이유는 sdk-trace-base 가 apps/medusa 의 직접
 * 의존성이 아니기 때문이다 (transitive 의존에 기대면 hoisting 에 취약하다).
 */
export interface SpanExporterLike {
  export(spans: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

export class RedactingSpanExporter implements SpanExporterLike {
  constructor(private readonly inner: SpanExporterLike) {}

  export(spans: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void {
    for (const span of spans) {
      const target = span as { attributes?: Record<string, unknown> };
      if (target.attributes) {
        // ReadableSpan.attributes 는 타입상 readonly 지만 런타임에는 평범한 객체다.
        // 내보내기 직전에 정리본으로 교체한다 — 이 시점 이후로 span 을 읽는 것은
        // exporter 뿐이므로 다른 소비자에 영향이 없다.
        target.attributes = redactSpanAttributes(target.attributes);
      }
    }

    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
```

- [ ] **Step 2: log exporter 래퍼 작성**

`apps/medusa/src/observability/redacting-log-exporter.ts`:

```typescript
import { redactLogRecordFields } from './redact-log-record';

interface ExportResultLike {
  code: number;
  error?: Error;
}

/**
 * `@opentelemetry/sdk-logs` 의 LogRecordExporter 와 구조적으로 호환되는 최소 형태.
 */
export interface LogRecordExporterLike {
  export(logs: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void;
  shutdown(): Promise<void>;
}

export class RedactingLogExporter implements LogRecordExporterLike {
  constructor(private readonly inner: LogRecordExporterLike) {}

  export(logs: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void {
    for (const log of logs) {
      const target = log as { body?: unknown; attributes?: Record<string, unknown> };
      const redacted = redactLogRecordFields(target);
      target.body = redacted.body;
      target.attributes = redacted.attributes;
    }

    this.inner.export(logs, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
```

- [ ] **Step 3: `instrumentation.ts` 배선**

`apps/medusa/instrumentation.ts` 를 아래로 교체한다. 변경점은 import 2 줄과 exporter 를 감싸는 부분뿐이다. `instrument` 는 그대로 둔다.

```typescript
import { registerOtel } from '@medusajs/medusa';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { RedactingLogExporter } from './src/observability/redacting-log-exporter';
import { RedactingSpanExporter } from './src/observability/redacting-span-exporter';

export function register() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping instrumentation');
    return;
  }

  // Medusa v2.13.4 는 HTTP span 에 요청 헤더를 통째로 스프레드한다. redaction 래퍼가
  // 내보내기 직전에 걸러낸다 — 자세한 근거는
  // docs/superpowers/specs/2026-08-14-medusa-otel-credential-redaction-design.md
  const exporter = new RedactingSpanExporter(
    new OTLPTraceExporter({
      url: `${endpoint.replace(/\/+$/, '')}/v1/traces`,
    }),
  );
  const logExporter = new RedactingLogExporter(
    new OTLPLogExporter({
      url: `${endpoint.replace(/\/+$/, '')}/v1/logs`,
    }),
  );

  registerOtel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'almond-young-medusa',
    exporter,
    logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
    instrument: {
      http: true,
      workflows: true,
      query: true,
      db: true,
    },
  });
}
```

- [ ] **Step 4: 기존 테스트가 계속 통과하는지 확인**

```bash
npm run test:medusa
```

기대: PASS — Task 1~3 의 35 개 케이스 (12+10+16, Task 3 은 재귀·깊이·순환·exotic보호 테스트 추가) + 기존 5 개 spec 파일 전부 통과.

- [ ] **Step 5: 타입이 맞는지 빌드로 확인**

구조적 타이핑이 `registerOtel` 의 `SpanExporter` / `LogRecordProcessor` 자리에 실제로 들어가는지는 빌드로만 확인된다.

```bash
npm --prefix apps/medusa run build
```

기대: 빌드 성공. `RedactingSpanExporter` 가 `SpanExporter` 에 할당 불가하다는 타입 에러가 나면, `SpanExporterLike.export` 의 첫 인자를 `readonly unknown[]` 에서 `never[]` 로 바꿔 반공변 위치를 넓힌다 (메서드 파라미터는 bivariant 이므로 통상 `readonly unknown[]` 로 통과한다).

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/observability/redacting-span-exporter.ts apps/medusa/src/observability/redacting-log-exporter.ts apps/medusa/instrumentation.ts
git commit -F - <<'EOF'
feat(medusa): OTel exporter 를 redaction 래퍼로 감싼다

계측은 끄지 않는다 — trace 는 살리고 값만 막는 것이 목적이다. 래퍼는 정리하고
위임할 뿐이라 로직이 없고, 규칙은 전부 순수 함수에 있다. OTel 타입을 import 하지
않고 구조적 타이핑으로 맞춰 신규 의존성을 만들지 않았다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

### Task 5: Medusa 유닛 테스트 CI 워크플로

보안 수정의 회귀 방어선이 로컬에서만 도는 것은 없는 것과 같다. 루트 게이트는 `apps/medusa` 를 제외하므로 별도 워크플로가 필요하다.

**Files:**
- Create: `.github/workflows/medusa-unit-tests.yml`

**Interfaces:**
- Consumes: `npm run test:medusa` (기존 루트 스크립트, `cd apps/medusa && npm run test:unit`)
- Produces: 없음

- [ ] **Step 1: 워크플로 작성**

`.github/workflows/medusa-unit-tests.yml`:

```yaml
name: Medusa unit tests

# 루트 검증 게이트(verification-gates.yml)는 apps/medusa 를 덮지 않는다.
# tsconfig.json 의 exclude 에 apps/medusa 가 있어 type-check 가 보지 않고,
# 루트 jest 는 modulePathIgnorePatterns 로 /apps/medusa/ 를 제외한다.
#
# Medusa 는 자체 package-lock 과 jest 설정을 가진 별도 트리라 설치가 무겁다.
# 매 PR 에 붙이면 관계없는 변경까지 느려지므로 paths 필터로 Medusa 변경 시에만 돈다.

on:
  pull_request:
    paths:
      - 'apps/medusa/**'
      - '.github/workflows/medusa-unit-tests.yml'
  push:
    branches: [develop]
    paths:
      - 'apps/medusa/**'

concurrency:
  group: medusa-unit-tests-${{ github.ref }}
  cancel-in-progress: true

jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: apps/medusa/package-lock.json

      - name: Install (medusa)
        working-directory: apps/medusa
        run: npm ci

      - name: Unit tests
        working-directory: apps/medusa
        run: npm run test:unit
```

- [ ] **Step 2: YAML 문법 확인**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/medusa-unit-tests.yml')); print('YAML OK')"
```

기대: `YAML OK`

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/medusa-unit-tests.yml
git commit -F - <<'EOF'
ci: Medusa 유닛 테스트를 paths 필터 워크플로로 고정한다

루트 게이트는 tsconfig exclude 와 jest modulePathIgnorePatterns 로 apps/medusa 를
덮지 않는다. 보안 수정의 회귀 방어선이 로컬에서만 도는 것을 막되, Medusa 설치가
무거우므로 apps/medusa 변경 시에만 돌게 한다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

### Task 6: Alloy 2 차 방어선

collector 에 같은 두 규칙을 건다. 앱 레벨을 **대체하지 않는다** — Next.js 앱은 Alloy 를 거치지 않고, 비밀번호는 이미 프로세스를 떠난 뒤 지워진다. 미래의 알려지지 않은 유출원에 대한 그물이다.

**Files:**
- Modify: `deployments/lcnine/services/observability/alloy/config.alloy`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: transform 프로세서를 파이프라인에 삽입**

`config.alloy` 에서 batch 프로세서의 출력이 exporter 대신 transform 을 가리키게 바꾸고, transform 이 exporter 로 내보내게 한다.

`otelcol.processor.batch "traces"` 블록의 `output` 을 교체:

```alloy
otelcol.processor.batch "traces" {
	output {
		traces = [otelcol.processor.transform.redact.input]
	}
}
```

`otelcol.processor.batch "logs"` 블록의 `output` 을 교체:

```alloy
otelcol.processor.batch "logs" {
	output {
		logs = [otelcol.processor.transform.redact.input]
	}
}
```

두 batch 블록 바로 아래에 새 블록을 추가:

```alloy
// 2 차 방어선. 앱 레벨(Medusa instrumentation.ts) 이 주 방어선이고 이것은 그물이다.
// Next.js 앱들은 VPC 밖 Lambda 라 Alloy 를 거치지 않으므로 여기서 덮이지 않는다.
//
// 로그 규칙은 앱 레벨과 **의도적으로 다르다.** Alloy 는 NestJS 서비스 전체에 대해
// 유일한 방어선이다 — 그 서비스들은 앱 레벨 redaction 이 없다. 그래서 로그는 body 뿐
// 아니라 최상위(top-level) attribute 의 문자열 값 전체를 스캔한다. 이는 앱 레벨(재귀
// 스크럽)과 동등하지 않다 — nested map/array 형태의 attribute 값은 이 OTTL 규칙이
// 문자열 형태로만 매칭하므로 스크럽되지 않은 채 통과한다. 그래도
// `exception.message`/`exception.stacktrace` 두 키만 훑던 옛 규칙보다는 커버리지가
// 훨씬 넓다 — Alloy 가 유일한 방어선인 서비스에 대해 좁은 두 키 한정 규칙은 구멍이었다.
//
// span 규칙은 앱 레벨과 같다:
//   1. 점 없는 attribute 키 삭제 — OTel semconv 는 전부 점 네임스페이스이고,
//      Medusa 가 스프레드한 원시 HTTP 헤더명은 점이 없다.
//   2. OTel 헤더 캡처 semconv 삭제 — http.request.header.*, http.response.header.*
//      는 원시 헤더 값을 담도록 설계돼 점이 있어도 명시적으로 차단한다.
//   3. 접속 문자열의 비밀번호 마스킹 — 이미 마스킹된 값에 다시 적용해도 결과가 같다.
otelcol.processor.transform "redact" {
	trace_statements {
		context = "span"
		statements = [
			`delete_matching_keys(attributes, "^[^.]+$")`,
			`delete_matching_keys(attributes, "^http\\.(request|response)\\.header\\.")`,
			`replace_pattern(attributes["db.connection_string"], "://([^:/?#\\s@]*):([^\\s/?#]*)@", "://${1}:[REDACTED]@")`,
		]
	}

	log_statements {
		context = "log"
		statements = [
			`replace_pattern(body, "://([^:/?#\\s@]*):([^\\s/?#]*)@", "://${1}:[REDACTED]@")`,
			`replace_all_patterns(attributes, "value", "://([^:/?#\\s@]*):([^\\s/?#]*)@", "://${1}:[REDACTED]@")`,
		]
	}

	output {
		traces = [otelcol.exporter.otlp.grafanacloud_tempo.input]
		logs   = [otelcol.exporter.otlphttp.grafanacloud_loki.input]
	}
}
```

**로그 규칙이 두 키 한정에서 `replace_all_patterns(attributes, "value", ...)` 로 바뀐 이유:**
Alloy 는 NestJS 서비스(Core, Wallet, Membership 등) 전체에 대해 **유일한** redaction
계층이다 — 그 서비스들은 앱 레벨 스크럽이 없다. `exception.message`/`exception.stacktrace`
두 키만 훑는 좁은 규칙은 Medusa 앱 레벨(모든 attribute 를 재귀 스크럽)과 커버리지가
달라 두 티어가 "같은 규칙"이라는 설계 문서의 서술과 어긋났다. `replace_all_patterns`
는 OTTL 이 제공하는 map 전체 순회 함수로, 모든 최상위 attribute 값의 문자열 형태에
패턴을 적용한다. 단 `"value"` 모드는 값을 문자열로 매칭하므로 kvlist/array 같은
nested 값은 문자열 형태로 그대로 통과해 스크럽되지 않는다 — 앱 레벨
(`redactLogRecordFields`, `redact-log-record.ts:70-95`) 은 배열·평범한 객체까지
재귀로 훑으므로 두 티어는 동등하지 않다. 그래도 이전의 두 키 한정 규칙보다는
확실한 개선이다. `body` 문장은 그대로 둔다.

- [ ] **Step 2: Alloy 가 설정을 실제로 로드하는지 확인**

문법 오류뿐 아니라 OTTL 구문 오류도 컴포넌트 초기화 시점에 드러난다. 더미 환경변수로 띄워서 확인한다.

```bash
docker run --rm \
  -v "$PWD/deployments/lcnine/services/observability/alloy/config.alloy:/tmp/config.alloy:ro" \
  -e GRAFANA_CLOUD_API_TOKEN=dummy \
  -e GRAFANA_CLOUD_PROMETHEUS_REMOTE_WRITE_URL=https://example.invalid/api/prom/push \
  -e GRAFANA_CLOUD_PROMETHEUS_USERNAME=0 \
  -e GRAFANA_CLOUD_TEMPO_OTLP_ENDPOINT=example.invalid:443 \
  -e GRAFANA_CLOUD_TEMPO_USERNAME=0 \
  -e GRAFANA_CLOUD_LOKI_OTLP_ENDPOINT=https://example.invalid/otlp \
  -e GRAFANA_CLOUD_LOKI_USERNAME=0 \
  -e SST_STAGE=validate \
  -e CORE_METRICS_TARGET=localhost:3000 \
  grafana/alloy:latest \
  run --server.http.listen-addr=0.0.0.0:12345 /tmp/config.alloy 2>&1 | head -40
```

기대: 컴포넌트 평가 에러 없이 기동 로그가 나온다 (외부 호스트가 `example.invalid` 라 export 실패 로그는 정상이다). `otelcol.processor.transform` 관련 파싱/평가 에러가 보이면 OTTL 구문을 고친다.

**확정: `$$1` 은 쓰지 않는다.** 로드 검증만으로는 이 문제가 드러나지 않는다 — `otelcol.processor.transform` 은 컴포넌트 초기화 시점에 statement 파싱만 확인하고, 캡처그룹 치환은 실제 데이터가 지나갈 때만 평가된다. Docker 로 OTLP/HTTP 에 실 페이로드(`db.connection_string = "postgresql://myuser:s3cr3t@localhost:5432/medusa"`)를 흘려 `otelcol.exporter.debug`(`verbosity = "detailed"`)로 결과를 확인한 결과, `$$1` 은 Go `regexp.Expand` 의 리터럴 `$` 이스케이프로 소비되어 사용자명이 **문자 그대로 `$1`** 로 깨졌다(`postgresql://$1:[REDACTED]@localhost:5432/medusa`) — 비밀번호는 어차피 캡처그룹 미참조라 새지 않았지만 사용자명 보존이 실패했다. `${1}` 로 바꿔 동일 페이로드로 재검증하니 `postgresql://myuser:[REDACTED]@localhost:5432/medusa` 로 정확히 나왔다. 계획·config 모두 `${1}` 로 확정.

**후속 확정 (2026-08-14, 최종 수정 라운드): `replace_all_patterns(attributes, "value", ...)`.**
로그 규칙을 `exception.message`/`exception.stacktrace` 두 키에서 전체 attribute 스캔으로
바꾼 뒤, 같은 Docker 방법(throwaway config 사본 + `otelcol.exporter.debug` 리라우팅)으로
재검증했다. 페이로드는 `body` 에 DSN 하나, `exception.message` 에 DSN 하나, 그리고
**목록에 없던 임의의 키** `custom.nested.field` 에 `redis://:hunter2@localhost:6379/0` 를
심어 "모든 attribute" 커버리지를 확인했다. 결과: 세 위치 전부 `[REDACTED]` 로 마스킹되고
`level: "error"` 처럼 DSN 이 없는 값은 그대로 남았다. 두 번째 페이로드(DSN 없는 로그,
문자열/정수 attribute 혼합)는 완전히 그대로 통과했고 per-item 에러 로그는 없었다. 명령과
전체 출력은 최종 수정 리포트(`.superpowers/sdd/2026-08-14-medusa-otel-credential-redaction/final-fix-report.md`)
참조.

- [ ] **Step 3: 커밋**

```bash
git add deployments/lcnine/services/observability/alloy/config.alloy
git commit -F - <<'EOF'
feat(observability): Alloy 에 자격증명 redaction 을 2 차 방어선으로 건다

앱 레벨을 대체하지 않는다 — Next.js 앱은 Alloy 를 거치지 않고, 비밀번호는 이미
프로세스를 떠나 VPC 내부를 흐른 뒤 지워진다. 미래의 알려지지 않은 유출원에 대한
그물로만 계산한다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

### Task 7: 사고 대응 런북

코드가 막는 것은 "앞으로" 다. 이미 나간 것은 사람이 처리해야 하고, 절차가 단순하지 않아 문서가 필요하다.

**Files:**
- Create: `docs/runbooks/2026-08-14-otel-credential-exposure.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 런북 작성**

`docs/runbooks/2026-08-14-otel-credential-exposure.md`:

````markdown
# 런북 — OTel 자격증명 노출 대응 (2026-08-14)

코드 수정(`fix/medusa-otel-credential-redaction`)은 **앞으로의 유출**만 막는다.
이미 Grafana Cloud 에 적재된 값은 이 문서의 절차로 처리한다. **실행은 사람이 한다.**

배경과 원인은 `docs/superpowers/specs/2026-08-14-medusa-otel-credential-redaction-design.md` 참조.

## 0. 선행 확인

### 0-1. Loki 에도 적재됐는지 확인

설계 시점에 **미확인**으로 남은 항목이다. 조회 자격증명이 필요하다:

```bash
cd deployments/lcnine/services
npx sst secret list --stage live | grep -i grafanacloudloki
```

`GrafanaCloudLokiOtlpEndpoint` 에서 호스트를, `GrafanaCloudLokiUsername` 에서 user 를 얻는다.
비밀번호는 `GrafanaCloudApiToken` 을 재사용한다.

```bash
curl -s -u "$LOKI_USER:$GRAFANA_TOKEN" -G \
  "https://$LOKI_HOST/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="medusa"} |= "postgresql://"' \
  -d "start=$(date -d '7 days ago' +%s)000000000" \
  -d "end=$(date +%s)000000000" \
  -d limit=5
```

결과가 비어 있지 않으면 로그에도 노출된 것이다. **출력에 실제 비밀번호가 포함되므로
터미널 스크롤백과 공유에 주의한다.**

### 0-2. retention 확인

grafana.com → 스택 → Tempo/Loki 의 retention 값을 확인한다. 아래 3 절의 "만료 대기"
기간이 여기서 정해진다.

## 1. DB 마스터 비밀번호 회전

**영향 범위가 전부다.** `deployments/lcnine/services/infra/shared.ts` 의 `dbUrl()` 이
만드는 자격증명을 논리 DB 11 개를 쓰는 전 서비스가 공유한다.

`sst.aws.Postgres('Db', { vpc })` 가 자동 생성한 값이라 회전이 단순하지 않다.

**핵심 주의:** RDS 마스터 비밀번호 변경은 즉시 적용되지만 **기존 커넥션은 살아남고
신규 커넥션만 실패한다.** 따라서 "변경 → 전 서비스 롤링 재시작" 이 한 세트다.
재시작을 빠뜨리면 커넥션 풀이 재연결을 시도하는 시점에 서비스가 산발적으로 죽는다.

절차:

1. 유지보수 창을 잡는다. 전 서비스 재시작이 필요하므로 트래픽이 낮은 시간대를 고른다.
2. 새 비밀번호를 SST Secret 으로 등록하고 `shared.ts` 의 Postgres 에 명시 주입하도록
   바꾼다 (자동 생성 → 명시 관리로 전환). 이 변경 자체가 코드 PR 이다.
3. `sst deploy --stage live` 로 RDS 비밀번호를 변경한다.
4. 전 서비스를 강제 재배포/재시작해 새 자격증명을 잡게 한다.
5. 각 서비스 헬스체크와 Core `/metrics` 의 `up` 을 확인한다.

**롤백:** 비밀번호를 되돌리는 것보다 전방 수정이 안전하다. 4 단계에서 일부 서비스가
실패하면 그 서비스만 재배포한다.

## 2. Medusa 토큰 회전

노출 창 = Tempo retention 전체. 그 기간 안에 Medusa `/auth/*`, `/admin/*`,
`/store/customers/me` 를 통과한 admin/store 토큰이 노출됐다.

`x-publishable-api-key` 는 공개 키 성격이라 **회전 대상이 아니다** (2026-08-14 확인).

## 3. 적재분 처리

Tempo/Loki 는 **선택 삭제가 불가능하다.** 두 선택지뿐이다:

- retention 만료를 기다린다 (0-2 에서 확인한 기간)
- Grafana 지원에 삭제를 요청한다

## 4. 완료 확인

수정 배포 후 새 trace 에 값이 없는지 확인한다:

```bash
curl -s -u "1523287:$GRAFANA_TOKEN" -G \
  'https://tempo-prod-20-prod-ap-northeast-0.grafana.net/tempo/api/v2/search/tag/span.authorization/values' \
  -d "start=$(date -d '1 hour ago' +%s)" -d "end=$(date +%s)"
```

기대: `{"tagValues":[]}` — 배포 이후 구간에서 태그가 사라져야 한다.

**주의:** Tempo 는 v2 태그 조회에 `span.` 스코프 프리픽스가 필수다. 없으면
`unknown identifier` 파싱 에러가 난다.
````

- [ ] **Step 2: 커밋**

```bash
git add docs/runbooks/2026-08-14-otel-credential-exposure.md
git commit -F - <<'EOF'
docs: OTel 자격증명 노출 대응 런북을 남긴다

코드는 앞으로만 막는다. 이미 적재된 값은 회전과 retention 만료로 처리해야 하고,
DB 마스터 비밀번호는 전 서비스가 공유하므로 "변경 → 롤링 재시작" 이 한 세트다.
회전 자체는 자동화하지 않고 사람이 실행한다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
```

---

## 최종 검증

- [ ] **전체 유닛 테스트**

```bash
npm run test:medusa
```

기대: PASS — 신규 35 케이스 (Task 3 은 재귀·깊이·순환·exotic보호 테스트 9개 추가) + 기존 5 spec 파일.

- [ ] **Medusa 빌드**

```bash
npm --prefix apps/medusa run build
```

기대: 성공.

- [ ] **루트 게이트가 깨지지 않았는지**

```bash
npm run type-check
npx jest --ci --silent
```

기대: 둘 다 에러 0 / 실패 0. 이 작업은 `apps/medusa`·`deployments`·`.github` 만
건드리므로 루트 게이트 범위에 변화가 없어야 한다.

## 배포

마이그레이션 0 건. 두 배포는 서로 독립이라 순서 제약이 없다.

- Medusa 재배포 (`sst deploy --stage live`)
- Alloy 재배포 (같은 stack 이므로 위 deploy 에 포함된다)

배포 후 런북 4 절의 확인 쿼리를 돌려 새 trace 에 값이 없는지 검증한다.
