# Drizzle migration 운영 전략

지금까지 모든 schema 는 `drizzle-kit push` 로 적용해 왔다. push 는 schema.ts 와 live DB 를 실시간 diff 해서 데이터 손실 위험 변경(컬럼 drop / rename / type narrow) 을 감지하면 **설계상 무조건** 프롬프트한다 — 즉 `--yes` 가 본질적으로 작동할 수 없다. `strict: false` 로 풀면 [[feedback_db_push_caution]] 의 사고(자동 DROP) 가 그대로 일어난다. PR 리뷰 시점에 무엇이 적용될지 사람이 볼 방법도 없어 변경의 예측 가능성이 낮다. 이 ADR 은 `push` 패턴을 `generate + migrate` 로 갈아끼우면서 그 위에 운영 컨벤션을 못 박는다.

## Decision

### 1. `drizzle-kit push` 폐기, generate + migrate 로 전환

- 모든 drizzle 서비스(`core`, `user-service`, `analytics`, `channel-adapter`, `membership`, `notification`, `ugc-service`, `wallet`, `file-service`) 의 `drizzle.config.ts` 에서 `strict`, `verbose` 제거하고 `migrations: { prefix: 'supabase' }` 추가.
- `npm run db:push:*` 전부 삭제. `scripts/db-push.sh` 도 삭제.
- `scripts/seeding/phases/02-schema-sync.ts` 가 호출하는 `drizzle-kit push` 를 `drizzle-kit migrate` 로 교체. 인터랙티브 확인 단계 자체가 사라지므로 prompt 분기 코드도 정리.

### 2. Migration 파일 네이밍 컨벤션

- `prefix: 'supabase'` — `yyyyMMddHHmmss_describe.sql` 포맷. parallel branch (이후 preview stage 도입 시) 충돌 회피용. file-service 가 이미 사실상 이 포맷을 쓰고 있어 통일 방향이 자연스럽다.
- **`--name` 강제**: `npm run db:generate:<svc> -- <kebab_description>` 형태만 허용. drizzle 의 자동 랜덤 이름 (`0001_smooth_black_queen`) 은 6 개월 뒤 PR 리뷰에서 의도 추적이 불가능하므로 차단.
- **Forward-only**. drizzle 은 down migration 을 generate 하지 않는다. file-service 의 `_down.sql` 손제작 파일들은 baseline 작업 때 제거. revert 가 필요하면 "원복 의도의 새 forward migration" 으로 표현.

### 3. `npm run db:setup` 의 3 phase 를 lifecycle 별로 분리

기존 `db:setup` 은 (1) 누락된 logical DB `CREATE DATABASE` → (2) schema push → (3) seed 를 한 명령에 묶었다. 셋의 변경 빈도와 실패 시 영향이 다르므로 분리한다.

| 신규 명령 | 책임 | 멱등성 요구 |
|---|---|---|
| `db:bootstrap` | 누락된 logical DB `CREATE DATABASE`. 환경 부트스트랩 시. | 필수 |
| `db:migrate` | `drizzle-kit migrate` 실행. schema 적용의 본체. | 자동 (드리즐 migrator) |
| `db:seed:ref` | 운영에 필요한 reference data (코드 테이블, 시스템 user 등). | 필수 (UPSERT / `ON CONFLICT DO NOTHING`) |
| `db:seed:demo` | 데모/개발용 sample data. live 거부. | 불요 |

ref / demo 의 구분은 `03-seed-orchestrator.ts` 가 이미 들고 있는 `DEMO_GROUP_PREFIX = 'demo-'` 위에 그대로 얹는다 — `db:seed:ref` 는 비-demo 그룹, `db:seed:demo` 는 demo- 그룹만 본다. `--allow-demo-in-prod` 같은 negative-flag 안전장치는 명령 자체를 분리하면서 사라진다 (`db:seed:demo` 가 `isProdStage()` 면 인자 검사로 거부, `db:seed:ref` 는 demo- 그룹을 *볼* 일 자체가 없음).

`db:setup` 은 위 넷을 묶는 wrapper 로 남기되, **interactive dev 도구로 정체성을 한정**한다 — `--yes` / `--non-interactive` 거부, `SST_STAGE === 'live'` 거부. 동시에 비대화식 진입점이었던 `db:setup:ci` alias 는 제거. CI / 비대화식 경로에선 wrapper 를 거치지 않고 4개 명령을 *직접* 호출한다. 이 정체성 분리로 "wrapper 가 실수로 비대화식으로 불려 demo seed 가 prod 로 새는 경로" 자체가 문법상 사라진다.

각 신규 명령은 현 `scripts/seeding/index.ts` 의 sst shell 재진입 로직을 `scripts/seeding/lib/sst-shell-relaunch.ts` 로 추출해 공유한다. 4개 entry 가 동일한 재진입 진입점을 거치므로 사람이 `sst shell` 밖에서 호출해도 안쪽에서 호출해도 동일하게 동작.

### 4. 배포 시점의 schema 적용

당분간 deploy 는 사람이 `sst deploy --stage <stage>` 를 직접 호출하는 모델 — SST Console autodeploy 는 현재 도입하지 않는다 (runner.vpc 의 dynamic SSM lookup 제약, SST Console 앱 등록 절차 등 *지금 풀기 어려운* unknown 이 누적되어 도입을 보류). 그에 따라 schema 적용은 다음 두 경로로 분리:

- **Medusa**: container entrypoint 가 자체 migration 을 부른다. `apps/medusa/Dockerfile` 의 `CMD ["sh", "-c", "yarn medusa db:migrate --execute-safe-links && yarn start"]` 형태가 그대로 정답. `medusa db:migrate --execute-safe-links` 한 줄이 schema migration + module link sync 를 묶어 처리. single-instance Medusa (`desiredCount=1`) 의 rolling deploy 중 새 task ↔ 옛 task 가 잠시 공존하는 좁은 window 의 race 는 §5 expand-contract 컨벤션이 일반 PR 의 안전성으로 흡수한다 (옛 task 가 새 schema 위에서 깨지지 않는 additive 만 허용).
- **Drizzle 12개 서비스**: container 자체 migration 없음. 사람이 `sst tunnel` 또는 `sst shell --stage <stage> -- npm run db:migrate -- --deployment <name> --yes` 를 *deploy 와 함께* 명시 호출. autodeploy 가 없는 만큼 *이 호출이 누락되지 않게 deploy 절차에 박아두는 것* 이 운영자 책임.

SST Console autodeploy 가 향후 도입 가능한 시점이 오면 본 ADR 의 별도 revision 또는 새 ADR 에서 다시 다룬다.

### 5. 보조 컨벤션

- **Migration 은 additive 또는 expand-contract.** Rolling deploy 중 *옛 task + 새 task 가 공존*하는 짧은 window 안에서 schema 와 코드가 *어느 조합으로 만나도* 안 깨지게 만드는 것이 본 컨벤션의 본체. 자세히:

  - **Expand phase 의 race 는 컨벤션으로**: 새 schema 가 옛 코드를 안 깨야 한다. ADD COLUMN / ADD TABLE / ADD INDEX / NULLABLE FK 추가 같은 *additive* 만 expand 로 인정. NOT NULL 추가 / DROP / RENAME / TYPE NARROW 는 expand 가 아님.
  - **Contract phase 의 race 는 deploy 순서로**: 운영자는 *deploy 가 먼저, migrate 가 나중* 순서를 지킨다 (`sst deploy` 가 새 코드 task 를 healthy 까지 띄우고 옛 task drain 까지 끝낸 *후* `db:migrate` 호출). `DROP COLUMN` 이 도는 시점엔 옛 코드(그 column 을 select 하던) 가 이미 사라져 있음. 이게 *contract 안전을 위한 의도된* 순서.

  변경 종류 별 PR 수 (참고용):

  | 변경 | PR 수 |
  |---|---|
  | 새 column / table / index / NULLABLE FK 추가 | **1 PR** (코드와 같은 PR OK) |
  | Column drop | **2 PR** — (1) 코드 사용 중단 (2) DROP |
  | Column rename / type narrow / table rename | **3 PR** — (1) 새 컬럼 추가 + dual write (2) backfill + read 전환 (3) 옛 컬럼 drop |
  | 기존 NULL 있는 column 에 `NOT NULL` 추가 | **3 PR** — (1) DEFAULT + 코드 NULL 안 만들기 (2) backfill (3) `SET NOT NULL` |

  **PR 사이에 deploy 가 끝나야 한다** — PR #1 머지 직후 PR #2 머지를 연속으로 해버리면 한 deploy 안에 두 phase 가 묶여 컨벤션 무력화. 적어도 한 번의 deploy 완료 (그리고 가능하면 운영 관찰 window) 가 PR 사이에 필요.

  컨벤션 강제는 CI hook 으로 보강: `.github/workflows/migration-safety.yml` 이 PR 의 새로 추가된 `apps/*/drizzle/<timestamp>_*.sql` 에 `DROP COLUMN|DROP TABLE|ALTER COLUMN .* TYPE|SET NOT NULL|RENAME COLUMN|RENAME TO` 패턴이 있으면 `destructive-migration` 라벨 자동 부착 + 체크리스트 코멘트. 리뷰어가 "이전 expand PR 이 이미 deploy 끝났는지" 사람 confirm.
- **`db:seed:ref` 의 모든 seed 는 idempotent.** UPSERT 또는 `ON CONFLICT DO NOTHING`. 매 deploy 마다 돌아도 데이터가 변하지 않아야 한다.
- **Medusa 의 schema 적용 경로는 §4 참조** — container entrypoint 가 자체 처리.

### 6. Baseline 전환 작업 (one-time)

현재 `apps/<svc>/drizzle/` 들은 `_journal.json` 정합이 깨져 있거나 (`core` 의 누락된 0000, `wallet` 의 meta 부재), 손제작 SQL (`session6-direct-ship-migration.sql`) 이 섞여 있거나, 한 번도 `drizzle-kit migrate` 가 돈 적 없어 prod/dev 어느 DB 에도 `__drizzle_migrations` 테이블이 존재하지 않는다. `live` 가 실질적으로 운영 데이터를 갖고 있지 않은 시점이므로, **fresh start** 를 택한다:

1. 모든 서비스의 `apps/<svc>/drizzle/` 안 SQL / `meta/` 일괄 삭제.
2. `db:generate:* -- baseline` 일괄 실행 — 현행 schema.ts 가 `<timestamp>_baseline.sql` 로 떨어짐.
3. dev RDS 의 모든 logical DB drop & recreate (또는 RDS 자체 재생성).
4. `db:bootstrap → db:migrate → db:seed:ref` 정상 흐름으로 부팅.
5. 이 시점부터 모든 schema 변경은 normal generate + migrate 사이클.

baseline PR 머지가 곧 push 패턴의 EOL.

## Why this shape

검토한 주요 대안과 기각 이유:

- **(α) `drizzle-kit push` 를 `--strict false` 로 유지.** `--yes` 가 표면적으로 작동하지만 [[feedback_db_push_caution]] 의 자동 DROP 사고가 잠재한다. push 는 schema 와 DB 의 diff 결과를 런타임에 결정하므로, PR 리뷰 시점에 무엇이 적용될지 사람이 볼 방법이 없다 — *예측 가능성*이 깨진다. 기각.
- **(β) Migration 을 SST 리소스 그래프 안에 `sst.aws.Task` + `pulumi.local.Command` 로 표현, service.dependsOn 으로 ordering 강제.** SST graph 안의 일관성이 매력적이지만 (i) Pulumi 가 DB 안의 상태 변경을 state 로 다룰 수 없어 실패 시 자동 롤백이 불가능 — 그래프 시멘틱과 실제 의미가 어긋난다, (ii) 이미 `db:setup` 이 `sst shell` re-exec / deployment 별 registry / Phase 분리 / `--yes` 모드를 갖춘 견고한 오케스트레이터인데 이를 폐기해야 한다. 기각.
- **(γ) SST Console autodeploy 도입.** 매력적인 자동화지만 (i) `console.autodeploy.runner.vpc` 가 `sync function` 만 받아 dynamic SSM lookup 이 불가 — VPC private subnet 의 cross-stack 값을 hardcode 해야 함, (ii) SST Console 측 앱 등록 / runner.vpc IAM / CodeBuild NAT 등 풀어야 할 unknown 이 누적, (iii) ECS rolling 의 새 task healthy 와 migrate step 의 시간 순서 가정이 expand-contract 컨벤션 위반 PR 에 취약. *지금 도입은 보류*, 별도 ADR 또는 본 ADR 의 revision 으로 재검토.

## Consequences

- **`live` 의 첫 운영 데이터 진입 전에 migration 사고 시뮬레이션을 한 번 해야 한다.** dev 에서 destructive migration 을 일부러 만들어 expand-contract 컨벤션 + CI hook 이 실제로 작동하는지 검증. 컨벤션이 어겨지는 첫 사례가 운영 데이터 손실로 직결되기 때문.
- **`db:seed:demo` 가 의도치 않게 live 에 흘러가는 것을 방어하는 책임은 운영자에게 남는다.** 명령이 분리되어 있고 `db:seed:demo` 자체가 `SST_STAGE === 'live'` 거부 가드를 갖지만, 새로운 demo seed 가 추가될 때 그 가드가 *해당 step* 까지 흘러가는지는 작성자가 명시 확인.
- **drizzle 서비스의 schema 적용은 `sst deploy` 와 사람이 짝지어 호출.** §4 의 결정대로 autodeploy 가 없는 상태에선 *deploy 절차 자체에 `db:migrate` 호출이 명시*되어야 누락이 안 생긴다. 운영 문서 / deploy 체크리스트에 박을 책임.
- **baseline 전환 PR 이 머지되는 순간 모든 개발자의 로컬 dev DB 가 한 번 wipe 되어야 한다.** PR description 에 명시. 머지 후 첫 pull 한 사람이 자기 logical DB 들을 drop & recreate 하고 `db:setup` 재실행.
