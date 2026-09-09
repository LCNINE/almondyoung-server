# 크론 «주기당 한 번» 선점 — `@app/cron-once` 설계

- 이슈: #821 (`scaling.max > 1` 을 켤 때의 크론 리더 선출 — #707 감사가 이연한 과제)
- 날짜: 2026-09-10
- 상태: 승인됨 (설계 대화에서 구두 승인, 구현 계획으로 이행)

## 1. 문제

ECS 롤링 배포는 매 배포마다 같은 앱의 태스크 두 개를 겹치게 띄우고, `scaling.max > 1` 을
켜면 그 겹침이 상시가 된다. #707 감사는 «지금의 크론 44개가 겹침을 견딘다» 는 것을
확인했지만 겹침 자체를 없애지는 않았고, 정확성과 별개로 외부 호출(국세청·Medusa admin·
멤버십 서비스)이 두 배로 나가는 **비용** 문제는 남아 있다. 새 크론이 「읽은 목록을 따라
발행」 패턴으로 쓰이면 정확성 구멍도 다시 열린다.

목표: **한 앱의 태스크가 몇 개 떠 있든, 크론 한 주기는 클러스터 전체에서 한 번만 실행된다.**
새 크론이 이 규칙을 빠뜨릴 수 없어야 한다.

## 2. 결정

리더를 «선출» 하지 않는다. 대신 **주기마다 선점** 한다.

- 앱 DB 마다 `cron_runs(name, period_at)` 를 PK 로 하는 실행 기록 테이블을 둔다.
- 크론이 발화하면 «크론 이름 + 크론식에서 도출한 예정 발화 시각» 을
  `INSERT … ON CONFLICT DO NOTHING RETURNING` 으로 선점한다. 행을 얻은 태스크만 본문을
  실행하고, 못 얻은 태스크는 건너뛴다.
- 기록 행이 곧 실행 로그다. 이슈의 완료 판정(한 주기 실행 로그 1건)이 테이블에서 바로 나온다.

버린 후보:

- **advisory lock 만** — 주기 키가 없으면 A 가 락을 놓은 뒤 B 가 몇 ms 늦게 발화할 때 둘 다
  돈다. 락 보유 커넥션이 끊기면 이중 실행 창도 생긴다.
- **규율만(`RETURNING` 가드 스펙)** — 정확성은 지키지만 외부 호출 2배 비용을 못 막는다.
- **크론 전용 태스크 분리** — ServicesBundleA/B 가 여러 앱을 한 태스크에 묶은 구조라 태스크
  수가 늘어 비용 절감 방향과 충돌한다.

## 3. 구성 요소

새 라이브러리 `libs/cron-once` (`@app/cron-once`, `nest g lib` 로 생성). 세 부품이다.

### 3-1. `@CronOnce(expression, { name, timeZone? })`

`@nestjs/schedule` 의 `@Cron` 을 대체하는 메서드 데코레이터. 메타데이터만 남긴다.

- `name` 은 **필수**다. 선점 키이자 `SchedulerRegistry` 등록 이름이다. 앱 안에서 유일해야 한다.
- `timeZone` 은 `@Cron` 과 같은 의미로 크론 발화와 주기 키 도출 양쪽에 쓴다.
- 그 밖의 `@Cron` 옵션(`disabled`, `waitForCompletion` 등)은 받지 않는다. 현재 44개 중 쓰는
  곳이 없다(전수: `timeZone`·`name` 만).

### 3-2. `CronOnceExplorer`

Nest 의 `ScheduleExplorer` 와 같은 방식으로 `onModuleInit` 에 `DiscoveryService` +
`MetadataScanner` 로 `@CronOnce` 메서드를 찾아 `cron` 패키지의 `CronJob` 을 만들고
`SchedulerRegistry.addCronJob(name, job)` 로 등록한 뒤 시작한다. 콜백은 아래 선점기로 감싼다.

- `SchedulerRegistry` 는 같은 이름이 이미 있으면 throw 한다. 따라서 모듈이 두 벌 떠서 크론이
  두 번 등록되는 사고(#599, 8일간 무증상)는 **부팅에서 즉시 죽는다.** 이것은 의도한 성질이다.
- 등록이 끝나면 앱 이름과 등록 개수를 `log` 로 남긴다. 모듈이 빠져서 크론이 «조용히 안 도는»
  상태를 로그에서 구별하기 위해서다.
- 본문 예외는 Nest 의 `wrapFunctionInTryCatchBlocks` 처럼 잡아서 `error` 로 남긴다. 프로세스를
  죽이지 않는다.

### 3-3. `CronRunClaimer`

`DbService` 를 주입받아 raw SQL 로 선점·완료를 기록한다. 앱 스키마 타입에 의존하지 않는다.

**주기 키** — 벽시계가 아니라 **크론식에서 도출한 예정 발화 시각**이다.
`cron-parser` 로 `parseExpression(expr, { currentDate: now + 50ms, tz }).prev()` 를 구한다.
50ms 는 타이머가 경계보다 미세하게 앞서 발화할 때를 위한 여유다. 두 태스크의 시계가
한 주기 미만으로 어긋나면 같은 키를 계산한다.

**선점** — 한 왕복으로 끝낸다. 같은 이름의 오래된 행 정리를 CTE 로 붙인다(PK 접두 범위라
인덱스를 탄다).

```sql
WITH purge AS (
  DELETE FROM cron_runs
   WHERE name = $1 AND period_at < $2::timestamptz - interval '7 days'
)
INSERT INTO cron_runs (name, period_at, claimed_by)
VALUES ($1, $2, $3)
ON CONFLICT (name, period_at) DO NOTHING
RETURNING name
```

- `$2` 는 ISO 문자열로 바인딩한다. drizzle raw `sql` 에 `Date` 를 넘기면 매 호출 TypeError 다
  (`notification/metrics.service.ts:54` 전례).
- `$3` `claimed_by` 는 선택 provider 토큰 `CRON_ONCE_INSTANCE_ID` 의 값이고, 없으면
  `os.hostname()` 이다. Fargate 에서는 호스트명이 컨테이너 id 라 태스크를 구별한다. 토큰은
  통합 스펙이 컨텍스트 둘을 구별하려고 쓴다(§6).

**완료** — 본문이 끝나면 `finished_at = now(), outcome = 'ok' | 'error'` 로 갱신한다.

**실패 정책** — 선점 쿼리 자체가 실패하면(DB 불통 등) **건너뛰고** `error` 로그를 남긴다
(fail closed). 크론 본문은 어차피 DB 를 쓰므로 «건너뛰는 편이 낫다» 를 택한다.

**범위 밖** — 한 주기의 본문이 다음 주기보다 오래 걸릴 때의 겹침은 다루지 않는다. 다음 주기는
다른 태스크가 선점할 수 있어 두 본문이 동시에 돌 수 있는데, 이는 한 프로세스 안에서 `@Cron`
이 지금도 겹치는 것과 같은 성질이다. 그 크론이 문제라면 본문 쪽에서 lease 로 막는다.

### 3-4. `CronOnceModule`

`@Global()` 정적 모듈. `DiscoveryModule` 을 import 하고 `CronOnceExplorer`·`CronRunClaimer` 를
provider 로 둔다. 동적 모듈이 아니므로 Nest 11 의 참조 기준 dedupe 에 걸리지 않는다 —
여러 곳에서 import 해도 한 벌이다. `SchedulerRegistry` 는 전역 `SCHEDULE_ROOT` 가 export 한다.
`DbService` 는 각 앱의 `DbModule.forRoot` 가 export 한다.

### 3-5. 테이블 `cron_runs` (`public`)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `name` | `varchar(100)` NOT NULL | 크론 이름 |
| `period_at` | `timestamptz` NOT NULL | 예정 발화 시각 |
| `claimed_by` | `varchar(100)` NOT NULL | 호스트명 |
| `claimed_at` | `timestamptz` NOT NULL DEFAULT now() | |
| `finished_at` | `timestamptz` NULL | |
| `outcome` | `varchar(20)` NULL | `ok` / `error` |

PK `(name, period_at)`. 정의는 `libs/cron-once/src/cron-runs.schema.ts` 한 곳에 두고, 앱 7개의
`drizzle.config.ts` 가 `libs/events/src/outbox/outbox.schema.ts` 를 물듯이 이 파일을 schema
목록에 더한다. 보존 기간 7일이면 가장 잦은 변환 대상(매분 2개, core)이 만드는 행은 앱당
2만 행 남짓이다.

## 4. 적용 범위

`@Cron` 44개(앱 7개)를 `grep -rn "@Cron(" apps/*/src --include=*.ts | grep -v '\.spec\.'` 로
도출한다.

- **40개를 `@CronOnce` 로 교체**한다. 이름이 없던 크론에는 `<모듈>-<동사구>` 꼴의 이름을 새로
  준다. 한 파일에 크론이 여럿이면(예: `recurring-billing.service.ts` 4개) 각각 다른 이름이다.
- **core 의 CAS 폴러 4개는 `@Cron` 을 유지**한다: `bulk-session-job.worker`(5초),
  `form-export-job.worker` 의 10초 폴러, `fulfillment-order-reservation-retry.worker`(10초),
  `fulfillment-order-creation-backlog.worker`(10초). 이들은 `lease_until` CAS 로 겹침에 이미
  안전하고 오히려 스케일아웃 대상이라, 한 번만 돌게 만들면 처리량을 깎는다. 바로 윗줄에
  `// cron-overlap-safe: <근거 한 줄>` 마커를 단다. `form-export-job.worker` 의 일일 정리
  크론은 교체 대상이다.
- `setInterval` 폴러(#815 consumer lag 등 4곳)는 대상이 아니다. 겹쳐도 무해하고 크론이 아니다.

앱 7개에 additive 마이그레이션 각 1건: analytics · channel-adapter · core · membership ·
ugc-service · user-service · wallet. `nest g lib` 가 만드는 뼈대 외에 각 앱 루트 모듈에
`CronOnceModule` import 한 줄.

## 5. 가드 스펙

`libs/cron-once/src/guards/cron-once-guard.spec.ts` 가 저장소 전체를 읽어 세 가지를 지킨다.

1. `apps/*/src` 의 `@Cron(` 은 바로 윗줄에 `// cron-overlap-safe:` 마커가 있을 때만 허용한다.
2. `@CronOnce` 의 `name` 은 앱 안에서 유일하다. (부팅에서도 죽지만, 게이트에서 먼저 잡는다.)
3. `@CronOnce` 를 하나라도 쓰는 앱은 `CronOnceModule` 을 import 한다. 모듈이 빠지면 데코레이터
   메타데이터가 탐색되지 않아 크론이 **조용히 안 돈다** — 부팅 실패보다 나쁜 실패라 게이트가
   막아야 한다.

기존 `no-direct-schedule-forroot.spec.ts` 와 같은 방식(파일 grep 기반)이다.

## 6. 테스트

- **단위**: 선점기 — 행을 얻으면 본문 실행·`ok` 기록, 충돌이면 skip·본문 미실행, 본문 throw 면
  `error` 기록, 선점 쿼리 실패면 skip + error 로그. 주기 키 — 6필드/5필드 크론식, `timeZone`
  지정, 경계 직전 발화(50ms 여유). 탐색기 — `@CronOnce` 메서드를 registry 에 등록, 같은 이름
  둘이면 throw, 등록 개수 로그.
- **가드 스펙**: §5.
- **통합** (`REQUIRE_CRON_ONCE_DB=1` 가드, `libs/cron-once/src/cron-once.integration.spec.ts`):
  Nest 앱 컨텍스트 **둘**을 같은 `DATABASE_URL` 로 띄운다. 각 컨텍스트는 자기 `DbService`
  커넥션과 `@CronOnce('* * * * * *', { name: 'probe' })` 매초 프로브 프로바이더를 갖는다.
  3~4초 뒤 판정한다.
  - `cron_runs` 의 `probe` 행 수 ≥ 2
  - 두 컨텍스트 실행 카운터의 합 = 행 수 (주기마다 정확히 한 번)
  - `claimed_by` 는 컨텍스트마다 다른 값을 주입해(기본 호스트명 대신) 두 값이 모두 등장하는지
    본다 — 한쪽이 항상 이기는 것이 아님을 확인한다.
  - 정리: 프로브 행 삭제, 두 컨텍스트 close.
  `scripts/local/test-core-integration-local.sh` 의 기본 패턴에 `libs/cron-once` 를 더해
  `npm run test:core:integration:local` 한 명령에 돈다(그 러너가 core DB 마이그레이션을 먼저
  적용한다).

## 7. 완료 판정 (이슈 본문 교정)

dev 스테이지는 쓰지 않으므로 「`scaling.max=2` 스테이지」 판정을 **로컬 두 프로세스 실측**으로
바꾼다. 이슈 본문의 완료 판정 절을 이 내용으로 고친다.

1. `npm run bootstrap:e2e:local` 로 postgres 를 띄우고 core 마이그레이션을 적용한다.
2. core 를 `PORT` 만 다르게 두 번 기동한다.
3. 2분 뒤 `SELECT name, period_at, claimed_by FROM cron_runs ORDER BY period_at DESC` 에서
   매분 크론(`product-sellable-quantity`, `bulk-image.cleaner`) 이 주기마다 **1행**이고,
   두 프로세스 로그에 한쪽은 실행, 다른 쪽은 skip 이 찍히면 완료다.

라이브에서 `scaling.max` 를 올리는 날 같은 쿼리로 재확인한다.

## 8. 배포

expand 이므로 **`migrate → deploy`** 순서다. user-service 는 `lcnine-auth` 배포라
`lcnine-services` 와 `lcnine-auth` 양쪽 모두 마이그레이션이 선행돼야 한다. 옛 태스크는 새
테이블을 모르므로 롤링 중에도 안전하다.

## 9. 문서

- ADR-0036 «크론은 리더 선출 대신 주기당 선점으로 한 번만 돈다» 를 짧게 남긴다. 규칙(앱의
  `@Cron` 은 마커 없이 금지)과 버린 후보의 이유가 본문이다.
- `CLAUDE.md` 의 Architecture 절에 한 단락: 크론은 `@CronOnce` 를 쓰고 예외는 마커로 표시한다.
- 이슈 #821 본문의 완료 판정 절을 §7 로 교정한다.
