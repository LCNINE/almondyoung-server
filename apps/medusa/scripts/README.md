# Medusa 운영 스크립트

런타임이 아닌 build-time 또는 호스트에서 돌리는 스크립트. 컨테이너 내부 `medusa exec` 스크립트는
`apps/medusa/src/scripts/` 에 있음.

## extract-core-snapshots.ts

Core(구 PIM) DB 의 active master 스냅샷을 한 번에 dump 해서 정적 JSON.gz 로 저장.
Medusa Docker image 빌드 시 image 에 baking 되어, 컨테이너 내부의 `backfill-from-core.ts`
스크립트가 외부 네트워크 없이 실행 가능하도록 해 준다.

### 실행

```bash
# SST 터널 활성 상태에서
npm run medusa:backfill:extract

# 옵션
npm run medusa:backfill:extract -- --limit=20            # 표본
npm run medusa:backfill:extract -- --batch-size=1000     # 페이지네이션 단위
npm run medusa:backfill:extract -- --out=/tmp/snap.json.gz
```

### 출력

- 기본: `apps/medusa/src/data/core-snapshots.json.gz`
- 형식: `{ meta: { extractedAt, totalCount, sourceHost, schemaVersion }, snapshots: PimProductSnapshot[] }`
- gzipped JSON. `.gitignore` 처리됨 (commit 금지).

## 백필 전체 절차

```bash
# 0. SST 터널 (extract 단계만 필요)
cd deployments/lcnine/services && npx sst tunnel --stage dev

# 1. Core 스냅샷 추출
npm run medusa:backfill:extract

# 2. Medusa scaling 적용 후 deploy (services.ts 의 cpu/memory/scaling 이 적용된 상태)
cd deployments/lcnine/services && npx sst deploy --stage dev
# (이 단계에서 src/data/core-snapshots.json.gz 가 image 에 baking)

# 3. 백필 실행 (Medusa 컨테이너 내부)
# AWS CLI v2 + SSM Session Manager Plugin 필요:
#   https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
# SST 가 클러스터 이름에 hash 를 붙여(예: lcnine-services-dev-ClusterCluster-xxxxxxxx)
# 매번 stage 별로 lookup 하는 게 안전하다.
CLUSTER_ARN=$(aws ecs list-clusters --query \
  "clusterArns[?contains(@, 'lcnine-services-dev-ClusterCluster')]|[0]" --output text)
TASK_ARN=$(aws ecs list-tasks \
  --cluster "$CLUSTER_ARN" --service-name Medusa \
  --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster "$CLUSTER_ARN" \
  --task "$TASK_ARN" --container Medusa --interactive \
  --command "sh -c 'BACKFILL_LIMIT=20 yarn backfill:run'"
# 표본 OK 면 BACKFILL_LIMIT 빼고 본 백필 실행

# 4. 검증 — Medusa 측 카운트
psql "$MEDUSA_DB_URL" -c "SELECT COUNT(*) FROM product WHERE metadata->>'pimMasterId' IS NOT NULL"

# 5. mapping 동기화 (channel-adapter pim_medusa_mappings 채우기)
npm run migrate:sync-mappings

# 6. verify
npm run migrate:verify -- --detailed

# 7. 원복 — services.ts 의 cpu/memory/scaling 제거 후 deploy
git checkout deployments/lcnine/services/infra/services.ts
cd deployments/lcnine/services && npx sst deploy --stage dev
```

## 잘못된 snapshot 백필 hard purge

공개 전/주문 전 환경에서 오래된 `core-snapshots.json.gz` 로 백필을 실행했다면, Medusa soft delete API 대신
컨테이너 내부 hard purge 스크립트로 PIM 백필 catalog row 를 제거한 뒤 최신 snapshot 으로 다시 백필한다.

```bash
CLUSTER_ARN=$(aws ecs list-clusters --query \
  "clusterArns[?contains(@, 'lcnine-services-live-ClusterCluster')]|[0]" --output text)
TASK_ARN=$(aws ecs list-tasks \
  --cluster "$CLUSTER_ARN" --service-name Medusa \
  --query 'taskArns[0]' --output text)

# 1. 대상 집계만 확인 (기본 dry-run)
aws ecs execute-command --cluster "$CLUSTER_ARN" \
  --task "$TASK_ARN" --container Medusa --interactive \
  --command "sh -c 'yarn purge:pim-backfill'"

# 2. 실제 hard delete
aws ecs execute-command --cluster "$CLUSTER_ARN" \
  --task "$TASK_ARN" --container Medusa --interactive \
  --command "sh -c 'PURGE_DRY_RUN=false PURGE_CONFIRM=purge-pim-backfill yarn purge:pim-backfill'"
```

기본 삭제 범위:
- `metadata.pimMasterId` 가 있는 product 및 product 하위 row
- 해당 variant 의 price set / projection inventory item / sales-channel link / shipping-profile link / sort-index
- `metadata.pimCategoryId` 가 있는 product category
- product 에 연결되지 않은 orphan product tag

`workflow_execution` history 는 기본 삭제하지 않는다. 정말 workflow 실행 history 까지 지워야 하는 경우에만
`PURGE_WORKFLOW_HISTORY=true` 를 추가한다.

## backfill-from-core.ts (컨테이너 내부)

`apps/medusa/src/scripts/backfill-from-core.ts` 는 `medusa exec` 로 실행되는 in-process 스크립트.

- 외부 네트워크 0 (image 에 baking 된 JSON.gz 만 읽음)
- `createProductsWorkflow` 일괄 호출로 HTTP/auth/ALB 우회
- 50건 chunk 단위 처리, `/tmp/backfill-progress.json` 체크포인트
- `BACKFILL_LIMIT`, `BACKFILL_BATCH_SIZE`, `BACKFILL_RESUME=true` 환경변수 지원

### 페이로드 모양 어댑트
transformer 의 출력은 Medusa Admin REST 컨트랙트(`AdminCreateProduct` — `categories: [{id}]`,
`tags: [{value}]`) 모양이다. 이는 채널어댑터 정상 동기화 흐름이 그대로 SDK 의 `admin.product.create`
로 흘려보내는 모양과 같다. 반면 in-process `createProductsWorkflow` 는 모듈 DTO 모양
(`category_ids: string[]`, `tag_ids: string[]`) 을 받는다. 이 차이를 흡수하는 `lib/payload-to-workflow-input.ts`
어댑터가 워크플로우 호출 직전에 페이로드를 변환한다. transformer 자체는 그대로 두는 것이 원칙.

## repair-product-links.ts (보강 — 컨테이너 내부)

`apps/medusa/src/scripts/repair-product-links.ts` — 1차 백필이 `category_ids` / `tag_ids` 누락된
상태로 들어간 경우(예: 어댑터 도입 이전 실행분) 카테고리·태그 링크를 한 번에 채워주는 멱등 스크립트.

- 동일 `core-snapshots.json.gz` 를 재사용 (image 에 baking 된 그대로)
- Medusa product 를 handle(=pim masterId) 기준으로 스캔하며 desired set 과 비교 → 다르면 한 번의 `productModule.updateProducts({ category_ids, tag_ids })` 로 둘 다 갱신
- 누락 태그는 prime 단계에서 `createProductTags` 로 미리 보충
- 멱등: 이미 일치하면 skip. 재실행 안전.
- 진행 상태: `/tmp/repair-progress.json`, 실패: `/tmp/repair-failures.json`
- 환경변수: `REPAIR_LIMIT`, `REPAIR_BATCH_SIZE`, `REPAIR_RESUME=true`, `REPAIR_SKIP_CATEGORIES=true`, `REPAIR_SKIP_TAGS=true`

```bash
CLUSTER_ARN=$(aws ecs list-clusters --query \
  "clusterArns[?contains(@, 'lcnine-services-dev-ClusterCluster')]|[0]" --output text)
TASK_ARN=$(aws ecs list-tasks \
  --cluster "$CLUSTER_ARN" --service-name Medusa \
  --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster "$CLUSTER_ARN" \
  --task "$TASK_ARN" --container Medusa --interactive \
  --command "sh -c 'yarn repair:product-links'"
```

## 주의

- **transformer 동기화**: `apps/medusa/src/scripts/lib/transformer.ts` 는 `apps/channel-adapter/.../pim-to-medusa.transformer.ts` 의 복사본. 한쪽 변경 시 양쪽 동기화 필요. **출력 모양은 Admin REST 컨트랙트** (`categories: [{id}]`, `tags: [{value}]`) — 모듈 DTO 경로에서 호출할 때만 어댑터로 변환.
- **scaling 원복**: 백필 끝나면 `services.ts` 의 cpu/memory/scaling 블록을 제거해 비용 누적 방지.
- **신규 master 누락**: extract → deploy → 백필 사이에 Core 에 신규 master 가 추가되면 빠짐. 이후 정상 이벤트 흐름으로 sync.
