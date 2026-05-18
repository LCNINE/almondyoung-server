# Drizzle migration 운영 전략 및 SST autodeploy 와의 결합

지금까지 모든 schema 는 `drizzle-kit push` 로 적용해 왔다. push 는 schema.ts 와 live DB 를 실시간 diff 해서 데이터 손실 위험 변경(컬럼 drop / rename / type narrow) 을 감지하면 **설계상 무조건** 프롬프트한다 — 즉 `--yes` 가 본질적으로 작동할 수 없다. `strict: false` 로 풀면 [[feedback_db_push_caution]] 의 사고(자동 DROP) 가 그대로 일어난다. 한편 SST Console autodeploy 도입 ( `main → live`, `develop → dev` ) 을 목표로 잡은 상태에서, 이 인터랙티브 도구는 자동화의 구조적 걸림돌이다. 이 ADR 은 `push` 패턴을 `generate + migrate` 로 갈아끼우면서 그 변경이 autodeploy 의 어디에 꽂히는지까지 못 박는다.

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

| 신규 명령 | 책임 | autodeploy 포함 | 멱등성 요구 |
|---|---|---|---|
| `db:bootstrap` | 누락된 logical DB `CREATE DATABASE`. 환경 부트스트랩 시. | 포함 (idempotent 라 무해) | 필수 |
| `db:migrate` | `drizzle-kit migrate` 실행. autodeploy 의 핵심. | 포함 | 자동 (드리즐 migrator) |
| `db:seed:ref` | 운영에 필요한 reference data (코드 테이블, 시스템 user 등). | 포함 | 필수 (UPSERT / `ON CONFLICT DO NOTHING`) |
| `db:seed:demo` | 데모/개발용 sample data. | **금지** (live 흘러가면 사고) | 불요 |

`db:setup` 은 위 넷을 인터랙티브로 묶는 dev 편의 wrapper 로만 유지. 새로 추가되는 기능 없음. `--allow-demo-in-prod` 같은 negative-flag 안전장치는 명령 자체를 분리하면서 사라진다.

### 4. SST Console autodeploy workflow 의 명령 순서

`deployments/lcnine/services/sst.config.ts` 와 `deployments/lcnine/auth/sst.config.ts` 양쪽에 `console.autodeploy` 블록 추가:

```ts
console: {
  autodeploy: {
    target(event) {
      if (event.type !== "branch") return;
      if (event.branch === "main") return { stage: "live" };
      if (event.branch === "develop") return { stage: "dev" };
    },
    async workflow({ $, event }) {
      const stage = event.branch === "main" ? "live" : "dev";
      const deployment = "lcnine-services"; // auth 측은 lcnine-auth

      await $`npm ci`;
      await $`npx sst deploy --stage ${stage}`;
      await $`npx sst shell --stage ${stage} -- npm run db:bootstrap -- --deployment ${deployment} --yes`;
      await $`npx sst shell --stage ${stage} -- npm run db:migrate -- --deployment ${deployment} --yes`;
      await $`npx sst shell --stage ${stage} -- npm run db:seed:ref -- --deployment ${deployment} --yes`;
    },
  },
}
```

**`sst deploy` 이후에 migration 이 돌도록** 의도적으로 잡았다 — `sst.aws.Postgres("Db")` 가 services stack 안에 있어 첫 배포에는 deploy 전에 RDS 가 존재하지 않기 때문. 평소 deploy 에서는 짧은 window 동안 새 service task 가 미적용 schema 를 보는 상황이 가능하지만, 아래 컨벤션 2 개가 지켜지면 무해하다.

### 5. 보조 컨벤션

- **Migration 은 additive 또는 expand-contract.** column drop / rename / type-narrow 을 같은 PR 의 코드 변경과 묶지 않는다. drop 은 (a) 코드에서 사용 중단 → ship → 운영 → (b) 후속 PR 에서 drop migration. autodeploy 의 "migration 이 deploy 뒤에 돈다" 가 안전한 전제.
- **`db:seed:ref` 의 모든 seed 는 idempotent.** UPSERT 또는 `ON CONFLICT DO NOTHING`. 매 deploy 마다 돌아도 데이터가 변하지 않아야 한다.
- **Medusa 는 별도 step.** drizzle 이 아니라 Medusa 자체 migration 시스템이므로 같은 workflow 안에서 `npx sst shell --stage ${stage} -- npx medusa db:migrate` 로 호출. Container entrypoint 안에서 자체 migration 돌리는 옵션은 다중 task 동시 부팅 시 race 위험이 있어 채택 안 함.

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

- **(α) `drizzle-kit push` 를 `--strict false` 로 유지하면서 autodeploy.** `--yes` 가 표면적으로 작동하지만 [[feedback_db_push_caution]] 의 자동 DROP 사고가 매 deploy 마다 잠재된다. push 는 schema 와 DB 의 diff 결과를 런타임에 결정하므로, PR 리뷰 시점에 무엇이 적용될지 사람이 볼 방법이 없다 — 자동화의 필수 전제(예측 가능성) 가 깨진다. 기각.
- **(β) Migration 을 SST 리소스 그래프 안에 `sst.aws.Task` + `pulumi.local.Command` 로 표현, service.dependsOn 으로 ordering 강제.** SST graph 안의 일관성이 매력적이지만 (i) Pulumi 가 DB 안의 상태 변경을 state 로 다룰 수 없어 실패 시 자동 롤백이 불가능 — 그래프 시멘틱과 실제 의미가 어긋난다, (ii) 이미 `db:setup` 이 `sst shell` re-exec / deployment 별 registry / Phase 분리 / `--yes` 모드를 갖춘 견고한 오케스트레이터인데 이를 폐기해야 한다, (iii) live stage 의 추가 gate (예: 수동 approval) 를 끼우기 어려워진다. 기각.
- **(γ) Migration 을 GitHub Actions 워크플로 안에서 처리, SST 는 단순 배포 도구.** SST Console autodeploy 와 GH Actions 가 deploy 의 owner 를 놓고 경합해 secret/state 흐름이 꼬인다. 이미 cross-stack SSM 패턴에 의존 중이라 SST 가 owner 인 게 일관적. 기각.
- **(δ) DB 를 `lcnine-platform` stack 으로 이동해 services 보다 먼저 deploy 되도록 하면 chicken-and-egg 자체가 사라진다.** 매력적이지만 Pulumi state migration 이 필요한 큰 리팩토링이고, `lcnine-auth` 가 `IdpDb` 를 자기 stack 에 가진 보안 격리 패턴과 어색하게 충돌한다. 현재 chicken-and-egg 는 "migration 을 deploy 뒤에 돌리고 additive 컨벤션을 지킨다" 로 무해하게 우회 가능하므로 지금은 보류. 운영 데이터 증가 후 재평가.
- **(ε) Preview stage 도입을 고려해 처음부터 DB 를 platform 의 공유 RDS + stage-prefix logical DB 모델로.** preview 가 본격 도입되는 시점에 옳은 그림이지만, 그때까지는 dev / live 만 있으므로 인프라 변경 없이 시작 가능하다. preview 도입 PR 에서 platform 쪽에 `PreviewDb` 추가하는 식으로 후순위 처리.

## Consequences

- **`live` 의 첫 운영 데이터 진입 전에 migration 사고 시뮬레이션을 한 번 해야 한다.** dev 에서 destructive migration 을 일부러 만들어 expand-contract 컨벤션이 실제로 작동하는지 검증. 컨벤션이 어겨지는 첫 사례가 운영 데이터 손실로 직결되기 때문.
- **`db:seed:demo` 가 의도치 않게 live 에 흘러가는 것을 방어하는 책임은 운영자에게 남는다.** 명령이 분리되어 있어 `npx sst shell --stage live -- npm run db:seed:demo` 를 직접 치지 않는 한 호출되지 않지만, 그 한 줄을 막는 자동 장치는 없음. 필요시 `db:seed:demo` 안에서 `SST_STAGE === 'live'` 면 거부하는 가드를 추가.
- **Medusa migration 의 실패가 다른 서비스의 정상 배포를 막을지 여부는 별도 결정.** workflow 안에서 `await` 순서로 묶으면 한쪽 실패가 전체 실패. 분리 실행이 필요하면 별도 step 으로 isolation.
- **baseline 전환 PR 이 머지되는 순간 모든 개발자의 로컬 dev DB 가 한 번 wipe 되어야 한다.** PR description 에 명시. 머지 후 첫 pull 한 사람이 자기 logical DB 들을 drop & recreate 하고 `db:setup` 재실행.
