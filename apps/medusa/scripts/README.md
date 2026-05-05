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
npx sst shell --stage dev -- yarn workspace medusa-service backfill:run
# 또는 ECS Exec 으로 컨테이너 진입 후:
#   yarn backfill:run

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

## backfill-from-core.ts (컨테이너 내부)

`apps/medusa/src/scripts/backfill-from-core.ts` 는 `medusa exec` 로 실행되는 in-process 스크립트.

- 외부 네트워크 0 (image 에 baking 된 JSON.gz 만 읽음)
- `createProductsWorkflow` 일괄 호출로 HTTP/auth/ALB 우회
- 50건 chunk 단위 처리, `/tmp/backfill-progress.json` 체크포인트
- `BACKFILL_LIMIT`, `BACKFILL_BATCH_SIZE`, `BACKFILL_RESUME=true` 환경변수 지원

## 주의

- **transformer 동기화**: `apps/medusa/src/scripts/lib/transformer.ts` 는 `apps/channel-adapter/.../pim-to-medusa.transformer.ts` 의 복사본. 한쪽 변경 시 양쪽 동기화 필요.
- **scaling 원복**: 백필 끝나면 `services.ts` 의 cpu/memory/scaling 블록을 제거해 비용 누적 방지.
- **신규 master 누락**: extract → deploy → 백필 사이에 Core 에 신규 master 가 추가되면 빠짐. 이후 정상 이벤트 흐름으로 sync.
