# 크론은 리더 선출 대신 «주기당 선점» 으로 한 번만 돈다

## Status
Accepted (2026-09-10). #821 의 결정. 설계 스펙은 `docs/superpowers/specs/2026-09-10-cron-once-design.md`.

## Context
ECS 롤링 배포는 매 배포마다 같은 앱의 태스크 두 개를 겹치게 띄우고, `scaling.max > 1` 이면 겹침이
상시가 된다. #707 감사는 크론 44개가 겹침을 «정확성» 면에서 견딘다는 것을 확인했지만(국소 결함은
#818·#820 이 닫음), 외부 호출(국세청·Medusa admin·멤버십) 이 두 배로 나가는 «비용» 과, 새 크론이
같은 결함을 다시 들여올 위험은 남았다. #599 에서는 Nest 11 의 모듈 dedupe 변경으로 모든 크론이
8일간 두 번씩 돌았는데 증상이 조용해 발견이 늦었다.

## Decision
- **리더를 선출하지 않는다. 주기마다 선점한다.** 앱 DB 마다 `public.cron_runs(name, period_at)` PK
  테이블을 두고, 크론 발화 시 «이름 + 크론식에서 도출한 예정 발화 시각» 을
  `INSERT … ON CONFLICT DO NOTHING RETURNING` 으로 선점한다. 행을 얻은 태스크만 본문을 돌린다.
  `cron_runs` 는 실행 로그 겸 판정 근거이며 보존 기간은 **7일**이다.
- **앱의 크론은 `@nestjs/schedule` 의 `@Cron` 대신 `@app/cron-once` 의 `@CronOnce(expr, { name })` 를
  쓴다.** `name` 은 필수·앱 내 유일. 앱 루트 모듈은 `CronOnceModule` 을 import 한다.
- **예외는 마커로 표시한다.** 겹쳐도 안전하고 오히려 스케일아웃해야 하는 폴러, 즉 `lease_until` CAS
  또는 `FOR UPDATE SKIP LOCKED` 로 작업을 집는 core 의 워커 3개 —
  `bulk-session-job.worker.ts`(5초 폴러, `lease_until` CAS),
  `form-export-job.worker.ts`(10초 폴러, `lease_until` CAS — 같은 파일의 일일 purge 크론은 CAS 가
  아니라 `@CronOnce` 로 전환했다), `fulfillment-order-creation-backlog.worker.ts`(10초 폴러,
  `FOR UPDATE SKIP LOCKED`) — 는 `@Cron` 을 유지하되 바로 윗줄에 `// cron-overlap-safe: <근거>` 를
  단다. `fulfillment-order-reservation-retry.worker.ts` 는 예외가 아니다 — 크로스 인스턴스 CAS 가
  없고 프로세스 내부 `isProcessing` 플래그와 락 없는 SELECT 뿐이라 `@CronOnce` 로 전환했다. 가드 스펙
  `libs/cron-once/src/guards/cron-once-guard.spec.ts` 가 마커 없는 `@Cron`, 이름 중복, 모듈 누락을
  막는다.
- **주기 키는 벽시계가 아니다.** `cron-parser.prev()` 로 크론식·타임존에서 도출한다(+50ms 지터
  여유). 두 태스크의 시계가 한 주기 미만으로 어긋나면 같은 키를 낸다.
- **선점 쿼리 실패는 건너뛴다(fail closed).** 본문은 어차피 DB 를 쓴다.
- **기록 행이 곧 실행 로그다.** 「한 주기 실행 1건」 판정은
  `SELECT name, period_at, claimed_by FROM cron_runs …` 로 한다. 반복 판정은
  `npm run test:cron-once:integration` (앱 컨텍스트 둘의 선점 경쟁).

## Consequences
- 같은 이름이 두 번 등록되면 `SchedulerRegistry` 가 부팅에서 throw 한다. #599 형 사고가 «8일 무증상»
  에서 «즉시 부팅 실패» 로 바뀐다. 의도한 성질이다.
- 크론이 있는 앱 7개(analytics · channel-adapter · core · membership · ugc-service · user-service ·
  wallet)에 additive 마이그레이션 1건씩. 배포는 `migrate → deploy` (user-service 는 `lcnine-auth`
  배포, 나머지는 `lcnine-services`).
- 한 주기의 본문이 다음 주기보다 오래 걸리면 다음 주기를 다른 태스크가 선점해 두 본문이 겹칠 수
  있다. 한 프로세스에서 `@Cron` 이 겹치던 것과 같은 성질이라 여기서 다루지 않는다 — 그 크론이
  문제라면 본문 쪽 lease 로 막는다.
- `setInterval` 폴러(#815 consumer lag 등)는 대상이 아니다.
- **마이그레이션 없이 배포되면(`deploy → migrate` 로 순서를 어기면) 크래시가 아니라 `@CronOnce`
  전부가 조용히 정지한다** — `cron_runs` 테이블이 없으니 매 틱 선점 쿼리가 실패하고, 러너는
  fail-closed 라 본문을 건너뛴다. 크래시가 없으니 괜찮다로 읽히기 쉽지만, 식별 신호는 매 틱
  반복되는 `claim failed` error 로그뿐이다.
- 프로세스 내부 `isProcessing`/`isSweeping` 류 가드(재시도 워커, bulk-image sweep 등)는 **선점
  뒤**에 평가된다. A 가 N 주기를 아직 돌리는 중에 N+1 틱이 오면 A 가 N+1 을 선점하고 본문이 즉시
  return 해 `outcome='ok'` 로 마감된다 — B 는 그 주기를 못 돈다. 단일 인스턴스와 같은 결과라
  회귀는 아니지만, 그 주기도 «선점된 것으로 소비» 되므로 `cron_runs` 는 «ok 인데 아무 일도
  안 함» 을 그냥 «ok」로 적는다.
- 롤링 배포 중 옛 태스크가 어떤 주기를 선점한 채 SIGTERM 을 맞으면 그 주기는 이미 소비되어
  새 태스크가 대신 돌 수 없다. 일일 알림 크론(`renewal-notice` 10:00 · `expiry-notice` 10:30 ·
  `billing-daily-scheduler` 09:00 — 셋 다 `timeZone` 없음, 곧 ECS 의 UTC)이 배포 시각과 겹치면
  그날 알림이 부분 발송으로 끝날 수 있다. 배포를 그 창 밖으로 두는 것으로 충분하다.

## Rejected
- **advisory lock 만** — 주기 키 없이는 짧은 작업에서 A 가 락을 놓은 뒤 B 가 몇 ms 늦게 발화하면
  둘 다 돈다. 커넥션이 끊기면 이중 실행 창도 생긴다.
- **`RETURNING` 규율만(가드 스펙)** — 정확성은 지키지만 비용 2배는 못 막는다.
- **크론 전용 태스크 분리** — ServicesBundleA/B 가 여러 앱을 한 태스크에 묶은 구조라 태스크 수가
  늘어 비용 절감과 충돌한다.
