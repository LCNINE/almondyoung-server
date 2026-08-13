# Medusa OTel 자격증명 유출 차단 설계

작성일: 2026-08-14

## 배경

Grafana Cloud Tempo 의 span 태그에 자격증명이 실값으로 적재돼 있다. 2026-08-14
실측으로 확인했다.

노출된 것:

| 태그 | 내용 |
|---|---|
| `authorization` | 요청 헤더 실값 (Bearer/Basic 토큰) |
| `db.connection_string` | **Postgres 마스터 비밀번호 포함** |
| `cookie`, `x-publishable-api-key` 등 | 요청 헤더 전량 |

발신은 **100% Medusa** 다. TraceQL `{span.authorization != nil}` 로 조회한 100 개
trace 의 `rootServiceName` 이 전부 `medusa` 였고, root 에는
`/auth/:actor_type/:auth_provider`, `/store/customers/me`, `/admin/*` 이 포함된다 —
실제 자격증명이 흐르는 경로다.

## 원인

Medusa 업스트림(v2.13.4) 이 HTTP span 에 요청 헤더를 통째로 스프레드한다.
`packages/medusa/src/instrumentation/index.ts`:

```typescript
span.setAttributes({
  "http.route": handlerPath,
  "http.url": req.url,
  "http.method": req.method,
  ...req.headers,          // 필터·마스킹·allowlist 없음
})
```

`apps/medusa/instrumentation.ts` 가 `instrument: { http: true }` 를 켠 순간
자동으로 이렇게 된다. 우리 코드에는 잘못된 줄이 없어서 리뷰로는 걸릴 수 없었다.

`db.connection_string` 은 이 스프레드가 아니라 `instrument: { db: true }` 가 붙이는
pg 계측에서 나온다. 별도 경로다.

NestJS 앱들은 무관하다 — `libs/shared/src/observability/telemetry.ts` 가
`getNodeAutoInstrumentations` 기본값이라 헤더를 담지 않는다.

## 심각도

Postgres 는 `sst.aws.Postgres('Db', { vpc })` 로 생성돼 VPC 프라이빗이다. 비밀번호만으로는
접속할 수 없고 VPC 접근(배스천 등)이 함께 필요하다. 다만 `dbUrl()` 이 만드는 자격증명을
**논리 DB 11 개를 쓰는 전 서비스가 공유**하므로, 유출된 것은 Medusa 전용이 아니라 공용
마스터 비밀번호다.

## 범위

**포함**

1. Medusa span 에서 헤더 유래 속성 제거 + `db.connection_string` 비밀번호 마스킹
2. Medusa 로그에서 접속 문자열 스크럽 (`exception.message`/`exception.stacktrace`/body)
3. Alloy(collector) 에 같은 규칙을 2 차 방어선으로 추가
4. 회귀 방어용 유닛 테스트 + paths 필터 CI 워크플로
5. 사고 대응 런북 문서 (실행은 사람)

**제외**

- DB 비밀번호 회전 *실행* — 런북으로 남기고 이번 브랜치에서 수행하지 않는다.
  전 서비스 롤링 재시작이 한 세트라 코드 변경과 분리한다.
- `x-publishable-api-key` 회전 — 유출돼도 무방하다고 확인됨 (공개 키 성격).
- Next.js 앱(admin-web/wallet-web/storefront/auth-web) — `@vercel/otel` 이라
  헤더를 담지 않는다. Alloy 도 안 거치므로 이번 변경의 대상이 아니다.
- **user-service** — `deployments/lcnine/auth/infra/services.ts:103-105` 가
  `OTEL_EXPORTER_OTLP_ENDPOINT`/`GRAFANA_OTLP_INSTANCE_ID`/`GRAFANA_OTLP_TOKEN` 을 주입해
  Grafana Cloud OTLP 게이트웨이로 **직접** 보낸다 — Next.js 앱과 같은 이유(auth→services
  순환 의존 회피)로 Alloy 를 거치지 않는다. NestJS 서비스라 Next.js 와 달리 헤더 스프레드
  위험은 낮지만(`getNodeAutoInstrumentations` 기본값), `DATABASE_URL: dbUrl('user_service')`
  로 **마스터 비밀번호를 담은 접속 문자열**을 쓰고 앱 레벨 redaction 도 Alloy 도 없다 —
  코드 커버리지 밖의 잔여 노출 지점이다. **정정:** 이 `dbUrl`은 services 앱의 11-논리-DB
  공유 Postgres(`Db`)가 아니라 auth 앱이 별도 소유한 `IdpDb`(`auth/infra/shared.ts:40`)의
  자체 마스터 비밀번호다 — 오늘은 `user_service` 하나만 이 인스턴스를 쓰지만, 노출되는
  비밀번호 자체는 services `Db` 와 **다른 값**이라 회전 범위를 산정할 때 별도로 다뤄야
  한다 (services 쪽만 회전하면 user-service 쪽은 그대로 노출된 채 남는다). §범위 밖 아래
  "코드로 덮이지 않는 범위" 참고.

## 설계

### 1. 모듈 구성

```
apps/medusa/src/observability/
├── mask-secrets.ts                    # maskConnectionStrings(text) — 양쪽 공용
├── redact-span-attributes.ts          # span 키 규칙 + mask
├── redact-log-record.ts               # log body/attribute 값 스크럽
├── redacting-span-exporter.ts         # SpanExporter 래퍼 (위임만)
├── redacting-log-exporter.ts          # LogRecordExporter 래퍼 (위임만)
└── __tests__/
    ├── mask-secrets.unit.spec.ts
    ├── redact-span-attributes.unit.spec.ts
    └── redact-log-record.unit.spec.ts
```

규칙을 **순수 함수로 분리**하는 것이 핵심이다. `maskConnectionStrings` 와
`redactSpanAttributes` 는 OTel SDK 도 네트워크도 없이 테스트되고, exporter 래퍼는
"정리하고 위임한다" 뿐이라 검증할 로직이 남지 않는다. 규칙을 exporter 안에 두면
테스트에 SDK 목킹이 필요해진다.

### 2. 규칙

**Span** — 키 기반:

| 조건 | 처리 | 예 |
|---|---|---|
| 키에 `.` 없음 | 삭제 | `authorization`, `cookie`, `accept-encoding` |
| `db.connection_string` | 비밀번호만 마스킹 | `postgresql://postgres:[REDACTED]@localhost:5432/medusa` |
| 그 외 | 통과 | `http.route`, `db.system`, `workflow.step.*` |

"점 없는 키 삭제" 는 OTel semconv 속성이 예외 없이 점 네임스페이스를 쓰고, 스프레드된
원시 HTTP 헤더명은 점을 쓰지 않는다는 차이에 기반한다. 열거형 blocklist 와 달리
**Medusa 가 새 헤더를 흘려도 자동으로 막힌다** — 이번 사고가 정확히 "모르는 사이에
라이브러리가 헤더를 붓는" 형태였으므로, 기본 정책을 "모르는 건 내보내지 않는다" 로 둔다.

헤더 유래 속성은 값을 `[REDACTED]` 로 남기지 않고 삭제한다. 값이 필요 없는데 남기면
span 속성 카디널리티만 늘어난다.

`db.connection_string` 은 통째로 지우지 않는다. 어느 호스트·어느 논리 DB 에 붙다
실패했는지가 디버깅에 실제로 쓰이므로 `://user:비밀번호@` 의 비밀번호 부분만 치환한다.

**Log** — 값 기반:

로그는 키가 아니라 값이 문제다. `exception.message` 나 스택트레이스 *문자열 안에*
접속 URL 이 박힌다 (Postgres 연결 실패 메시지의 흔한 형태). 키를 지워서는 막을 수 없다.

→ log record 의 body 와 모든 문자열 attribute 에 `maskConnectionStrings` 를 적용한다.

**로그에는 "점 없는 키 삭제" 규칙을 적용하지 않는다.** 그 규칙은 헤더 스프레드를 겨냥한
것이고 로그에는 헤더 스프레드가 없다. 로그 attribute 의 키는 전부 보존하고 값만 스크럽한다.

`maskConnectionStrings` 는 URL 의 자격증명 구간만 치환한다 — `://<user>:<secret>@` 에서
`<secret>` 부분만 `[REDACTED]` 로 바꾸고 스킴·사용자·호스트·경로는 보존한다. 한 문자열에
여러 개가 있으면 전부 치환한다. 정확한 정규식은 구현 시 확정하되, 위 동작이 테스트로
고정되는 계약이다.

### 3. 적용 지점

`apps/medusa/instrumentation.ts` 에서 두 exporter 를 감싼다. 계측 자체는 켠 채로 둔다 —
trace 는 살리고 값만 막는 것이 목적이다.

```typescript
registerOtel({
  serviceName,
  exporter: new RedactingSpanExporter(exporter),
  logRecordProcessors: [new BatchLogRecordProcessor(new RedactingLogExporter(logExporter))],
  instrument: { http: true, workflows: true, query: true, db: true },
});
```

두 exporter 모두 우리 `instrumentation.ts` 가 직접 조립하는 객체이므로 업스트림 수정이
필요 없다.

### 4. Alloy (2 차 방어선)

`deployments/lcnine/services/observability/alloy/config.alloy` 의 traces·logs 파이프라인에서
`batch` 와 exporter 사이에 프로세서 한 단계를 넣어 같은 두 규칙을 건다. metrics 는
Core `/metrics` 스크레이프라 해당 없음.

컴포넌트 선택(`otelcol.processor.attributes` 의 regex `pattern` 삭제 vs
`otelcol.processor.transform` 의 OTTL `replace_pattern`)은 구현 시 문법을 확인해 확정한다.

**Alloy 는 앱 레벨을 대체하지 않는다.** 세 가지 한계가 있다:

1. Next.js 앱들은 VPC 밖 Lambda 라 Alloy 를 거치지 않고 Grafana Cloud OTLP 게이트웨이로
   직행한다. collector 규칙이 적용되지 않는다.
2. **user-service 도 Alloy 를 거치지 않는다.** `deployments/lcnine/auth/infra/services.ts`
   가 Grafana Cloud OTLP 게이트웨이로 직접 전송하도록 설정돼 있다 (auth→services 순환
   의존을 피하려고 Next.js 앱과 같은 경로를 쓴다). NestJS 라 헤더 스프레드 위험은 낮지만
   `DATABASE_URL: dbUrl('user_service')` 가 마스터 비밀번호를 담은 접속 문자열이고, 이
   경로엔 앱 레벨 redaction 도 Alloy 도 없다 — 코드가 덮지 못하는 잔여 노출 지점이다.
   이 `dbUrl` 은 services 앱의 공유 `Db` 가 아니라 auth 앱이 별도 소유한 `IdpDb`
   (`auth/infra/shared.ts:40`) 의 자체 마스터 비밀번호라, 노출된다면 services 쪽 회전과
   별개로 다뤄야 한다. 완화 근거: 루트 lockfile(`package-lock.json`, user-service 가
   쓰는 트리)이 `@opentelemetry/instrumentation-pg@0.65.0` 을 고정해 접속 문자열을
   상류에서 마스킹하므로 오늘 시점 위험은 낮다.
3. 비밀번호가 프로세스를 떠나 VPC 내부 평문 OTLP(4318) 로 Alloy 까지 실제로 흘러간 뒤에
   지워진다. 사고 등급을 낮추지 못한다.

오늘자 실효 커버리지는 Medusa 하나다(다른 VPC 서비스는 헤더를 담지 않으므로). Alloy 규칙은
"지금 새는 것을 막는" 비용이 아니라 **미래의 알려지지 않은 유출원에 대한 그물** 로 계산한다.

부수 비용: Alloy 는 0.25 vCPU 단일 태스크이고 Medusa 가 `SimpleSpanProcessor` 로 span 을
전량 밀어넣으므로, 전 span OTTL 은 그 태스크 CPU 를 올린다. 치명적이지 않지만 공짜도 아니다.

### 5. 검증

**함정: 이 코드가 들어가는 트리를 기존 PR 게이트가 둘 다 덮지 않는다.**

- `tsconfig.json` 의 `exclude` 에 `apps/medusa` 가 있어 `npm run type-check` 가 보지 않는다
- 루트 jest 는 `modulePathIgnorePatterns: ["/apps/medusa/"]` 라 `npx jest` 도 보지 않는다
- Medusa 자체 러너: `npm run test:medusa` → `TEST_TYPE=unit`,
  testMatch `**/src/**/__tests__/**/*.unit.spec.[jt]s`

따라서 테스트 파일명은 반드시 `*.unit.spec.ts` 이고 `src/**/__tests__/` 아래에 둔다.

CI 는 **새 워크플로 `.github/workflows/medusa-unit-tests.yml`** 로 붙인다.
`on.pull_request.paths: ['apps/medusa/**']` 필터를 걸어 Medusa 변경 시에만 돈다.
`verification-gates.yml` 은 건드리지 않는다.

이유: 순수 함수를 `packages/` 로 빼면 기존 게이트가 그대로 덮지만, `apps/medusa` 는
현재 `@packages/*` 를 하나도 import 하지 않아 **런타임 해석이 검증된 적이 없다.**
실패 시 Medusa 부팅이 깨지는데 Medusa 는 지금 CPU 포화로 가장 취약한 서비스다.
CI 분을 아끼려고 부팅 위험을 지는 것은 나쁜 교환이므로, 코드는 `apps/medusa` 안에 두고
CI 비용은 paths 필터로 없앤다.

**테스트 케이스 (최소):**

- `maskConnectionStrings`: 비밀번호 치환 / 비밀번호 없는 URL 무변경 / 문자열 내 여러 개 /
  URL 없는 문자열 무변경
- `redactSpanAttributes`: 점 없는 키 삭제 / 점 있는 키 통과 / `db.connection_string` 마스킹 /
  빈 객체
- `redactLogRecord`: body 문자열 스크럽 / 문자열 attribute 스크럽 / 비문자열 attribute 무변경 /
  키는 삭제되지 않음

### 6. 배포

마이그레이션 0 건. Medusa 재배포와 Alloy 재배포는 서로 독립이라 순서 제약이 없다.

### 7. 런북 (문서 산출물, 실행은 사람)

`docs/runbooks/2026-08-14-otel-credential-exposure.md` 로 작성한다. 코드가 막는 것은
"앞으로" 이고 이미 나간 것은 별도 대응이 필요하다.

1. **DB 마스터 비밀번호 회전.** `sst.aws.Postgres` 가 자동 생성한 값이라 회전 경로가
   단순하지 않다. RDS 마스터 비밀번호 변경은 즉시 적용되지만 **기존 커넥션은 살아남고
   신규만 실패**하므로 변경 직후 전 서비스 롤링 재시작이 한 세트로 붙는다. 논리 DB 11 개를
   전 서비스가 공유하므로 영향 범위가 전부다.
2. **Tempo/Loki 적재분.** 선택 삭제가 불가능하다. retention 만료 대기 또는 Grafana 지원
   요청. 현재 플랜의 retention 확인이 선행된다.
3. **Medusa admin/store 토큰 회전.** 노출 창 = Tempo retention 전체.

런북은 절차와 검증 쿼리까지 적되 회전 자체를 자동화하지 않는다.

## 리스크

| 리스크 | 대응 |
|---|---|
| "점 없는 키 삭제" 가 정상 속성을 지운다 | 오늘 관측된 태그 목록 기준으로 점 없는 정상 semconv 속성은 없다. 배포 후 Tempo 태그 목록을 재확인해 손실을 검증한다. |
| Alloy OTTL 문법 오류로 파이프라인이 죽는다 | Alloy 변경은 Medusa 변경과 독립 배포. 문법은 구현 시 확정하고, 실패 시 collector 를 롤백한다. 단 앱 레벨 방어가 유지되는 건 Medusa 뿐이다 — §4 대로 Alloy 는 다른 NestJS 서비스 전체에 대해 유일한 로그 redaction 계층이므로, 그 서비스들은 collector 롤백 동안 로그 redaction 이 전무해진다. |
| 로그 스크럽이 접속 문자열 외 형태를 놓친다 | 이번 범위는 접속 문자열로 한정한다. 다른 형태의 시크릿 로깅은 별도 과제. |
| Medusa 재배포가 부팅 실패 | 변경이 exporter 래핑 두 줄 + 신규 순수 모듈이라 표면이 작다. 유닛 테스트로 순수 함수를 고정한다. |
| span `status.message`/span events 는 어느 티어도 스크럽하지 않는다 | Medusa 는 여러 지점에서 `span.setStatus({ code: ERROR, message: error.message })` 를 호출한다. `redactSpanAttributes` 는 `attributes` 만 다루므로 `status.message` 나 span event 안에 DSN 이 박히면(드라이버 에러 메시지가 그런 형태를 자주 띤다) 걸러지지 않고 Tempo 로 나간다. 이번 범위는 `attributes` 로 한정한다 — 문서화만 하고 구현하지 않는다. 후속 과제. |

## 미해결

- Loki 에 실제로 접속 문자열이 적재됐는지 **미확인.** Loki 조회 자격증명
  (`GrafanaCloudLokiOtlpEndpoint`, `GrafanaCloudLokiUsername`) 을 아직 받지 못했다.
  로그 경로 수정은 이 확인과 무관하게 진행하되(예방), 회전 범위 판단에는 확인이 필요하다.
- Grafana Cloud 플랜의 Tempo/Loki retention 값.
