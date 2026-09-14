# Task 2 report — 운영 절차와 reference 정리

## 변경

- `docs/runbooks/purchase-order-receiving-contract.md`를 추가했다. deploy → migrate 순서, 최신 source/전체 DB 복구
  지점, 정합성 세 SELECT, 두 테이블·두 컬럼·enum의 전체 dependency inventory, 허용 의존성, RESTRICT 방어,
  migration 전후 생존 영역과 적용 후 제거 확인을 실행 가능한 읽기 전용 SQL로 기록했다.
- 설계 spec §11/§15의 낡은 live 가정을 2026-09-14 23:55 KST 관측으로 보완했다. destination 135/1,775 삭제,
  source 및 발주 182/2,533 보존은 과거 증거로 유지했고, CSV import 코드 경로와 개별 행 provenance의 불확실성을
  구분했다.
- procurement module의 경계 owner/`received` 설명을 ADR-0039에 맞췄고 storefront restock metadata의 원천을
  outstanding purchase-order line으로 바로잡았다. 두 변경은 comment-only다.
- 실행 계획에 두 comment 파일과 Task 1/Task 2 완료 상태, 컨트롤러 실제 검증 결과를 반영했다. push/PR 단계와
  컨트롤러 review는 완료로 표시하지 않았다.

## 검증 명령과 결과

- 빈 `pr_c_t2_20260915` DB에 journal idx 0~94(PR-B backfill까지)를 순서대로 적용: exit 0.
- 위 PR-B fixture에서 runbook의 정합성 세 SELECT 실행: 각각 0 rows.
- 같은 fixture에서 runbook의 5-target `pg_depend` query 실행: 40 rows. 두 예상 외부 FK와 삭제 테이블의
  constraint/default/index/toast/row type, 테이블 간 FK, enum column/default/array type만 있었고 VIEW·예상 밖 외부
  FK·외부 enum 사용자는 없었다.
- `pr_c_head_20260915` read-only postcheck: 두 table과 enum removed = true, 두 column query = 0 rows,
  `stock_summary_view` exists = true / uses `purchase_order_lines` = true / uses legacy inbound plans = false. 생존 영역
  7개 query도 exit 0.
- `git diff --check`: exit 0.
- broad gates와 base/head integration 비교는 Task 1 commit `a7af70349`에서 컨트롤러가 이미 완료했다. 기록은
  `/home/pauseb/Documents/Codex/2026-09-15/pr-c-sol-docs-superpowers-specs-2/work/controller-verification.md`와 plan의
  실제 검증 절에 옮겼으며 다시 실행하지 않았다.
- 직접 만든 `pr_c_t2_20260915`는 검증 후 삭제했다. 공유/base/head DB에는 쓰지 않았고 head는 읽기만 했다.

## 남은 우려와 운영 조건

- 이번 작업은 live credential/DB/deploy를 사용하지 않았다. 실제 적용 직전에 세 정합성 결과와 dependency inventory를
  다시 확인하고 최신 source/전체 DB 복구 지점을 확보해야 한다.
- 기존 destination ZIP은 source 또는 전체 DB 백업이 아니다.
- core migration의 `.env` URL override 함정 때문에 live target 증거가 없는 성공 로그는 적용 증거가 아니다. 적용 후
  live postcheck가 필요하다.
- 문서에 남은 두 WMS API HTML은 PR-B 이전 snapshot이며 별도 문서 부채다.

## Final review fix wave

- `docs/runbooks/purchase-order-receiving-contract.md`: migration 명령을 저장소 root canonical form
  `npm run db:migrate -- --stage live --deployment lcnine-services --yes`로 수정했다. 실제 registry 기준 아홉 Drizzle
  서비스 범위와 `runSchemaSync`의 서비스별 catch-and-continue를 공개하고, 실행 전 pending set을 Core PR-C 두 개/나머지
  0개로 제한했다. exit 0 대신 아홉 서비스 각각의 성공 로그, 실패 로그 부재, live Core의 두 migration
  history/hash와 postcheck를 성공 조건으로 명시했다.
- `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md` §10.1: 구버전 창고 앱의 기능 손실이
  없다는 설계 당시 가정을 폐기했다. 설치된 구버전은 404로 예정 입고 기능을 잃을 수 있고 설치/사용/update 상태는
  확인하지 않았으며 native binary가 SST 서버 배포 기록에 포함되지 않는다고 기록했다.
- `docs/superpowers/plans/2026-09-15-purchase-order-receiving-pr-c.md`: 최초 parallel Jest worker teardown 경고와
  동일 전체 suite의 serial `--detectOpenHandles` 통과/비재현을 실제 검증 기록에 추가했다.
- 근거 확인: `scripts/seeding/lib/service-registry.ts`, `scripts/seeding/lib/sst-shell-relaunch.ts`,
  `scripts/seeding/phases/02-schema-sync.ts`, `scripts/seeding/migrate.ts`, Core journal과 두 migration SHA-256을 읽어 문서의
  명령·범위·오류 처리·history/hash를 대조했다. registry의 Drizzle 대상은 문서와 같은 9개였고 journal의 PR-C
  `created_at`은 `1789400689029`, `1789400895203`, 파일 SHA-256은 각각 문서의
  `1f22efdc...888ab`, `9695e02d...823ba`와 일치했다.
- `rg`로 옛 수동 `sst shell` 명령과 §10.1의 거짓 no-data/no-loss 문장이 제거됐고 canonical 명령과 서비스별 실패
  판정 문장이 존재함을 확인했다. `git diff --check`는 exit 0이었다. live 명령과 broad test는 실행하지 않았다.
