### WMS 재고상품마스터 + PIM 연동 요약 (현재 구현 상태)

이 문서는 WMS에 추가된 재고상품마스터 구조와 PIM 연동 흐름, 제공 API, 테스트 방법을 요약합니다.

### 개요

- SoT 분리: 판매상품/Variant(PIM), 재고상품/SKU(WMS), 매칭(WMS)
- 두 레이어:
  - 바닥 CRUD: SKU/바코드/매칭 자유도 높은 관리
  - 편의 추상화: 재고상품마스터 기반 옵션/옵션값으로 SKU 일괄 생성
- 동기 오케스트레이션: PIM 연동은 동기 호출, 외부 호출은 DB 트랜잭션 밖에서 수행

### 스키마(Drizzle)

- `inventory_product_masters`
  - 목적: 판매용 재고상품군의 설계 단위(옵션 스키마/정책 보유)
  - 주요 컬럼: `id`, `name`, `master_code`, `purpose(standard|set|material)`, `option_schema(json)`, `default_policy(json)`, `status(active|archived)`

- `inventory_master_sku_links`
  - 목적: 마스터 ↔ SKU 연결, 옵션키(JSON)로 조합 식별
  - 주요 컬럼: `master_id`, `sku_id`, `option_key(json)`, `is_primary`

- `product_matchings.master_id` (보완)
  - 목적: 판매상품(variant) ↔ 마스터 힌트 연결(1:1 의도 시), 전략/정책 귀속은 매칭 단위 유지

### 공유 라이브러리(Shared)

- OptionEngine
  - 위치: `libs/shared/src/option-engine/*`
  - 기능: 옵션 스키마 검증, 조합 생성, 옵션키 정규화

- PIM 포트/클라이언트/오케스트레이터
  - 위치: `libs/shared/src/pim/*`
  - `PimClientPort`: createMaster, getMasterDetail, generateVariants, deleteMaster
  - `PimHttpClient`: fetch 기반 동기 호출(+간단 재시도/백오프, 멱등키 헤더 지원)
  - `PimOrchestrator`: 마스터 생성→변형 생성, 실패 시 보상(delete)

### WMS 서비스/컨트롤러

- `MasterService` (트랜잭션 규칙 준수)
  - 위치: `apps/wms/src/inventory/services/master.service.ts`
  - `createMaster(params, tx?)`: inTx로 마스터 생성 → 트랜잭션 밖에서 PIM 연동(플래그로 제어)
  - `generateSkusFromOptions(masterId, tx?)`: 옵션 조합으로 SKU 생성 및 `inventory_master_sku_links` 작성
  - `syncWithPim(masterId)`: PIM에 마스터/변형 생성 후, WMS에 Variant 기준 pending 매칭 생성(upsert 유사)

- `InventoryService`
  - 변경: `createSku(dto, tx?)` 시그니처로 정리 + `inTx` 헬퍼 추가

- `MastersController`
  - 위치: `apps/wms/src/inventory/controllers/masters.controller.ts`
  - 엔드포인트:
    - `POST /wms/masters` 마스터 생성
    - `PUT /wms/masters/:id` 마스터 수정
    - `DELETE /wms/masters/:id` 마스터 삭제
    - `POST /wms/masters/:id/generate-skus` 옵션 조합 기반 SKU 생성
    - `POST /wms/masters/:id/pim-sync` PIM 동기화(마스터/변형 생성→WMS 매칭 pending)

### 트랜잭션 전달 규칙

- 퍼블릭 서비스 메소드: 마지막 파라미터 `tx?: DbTx`
- 내부 헬퍼: `tx: DbTx` 필수
- 트랜잭션 경계 열 때는 `this.inTx(exec, tx)` 사용(상위 tx 재사용)
- 외부 시스템(PIM) 호출은 트랜잭션 밖에서 실행

### 설정(환경변수)

- `PIM_SYNC_ENABLED` (true/false): PIM 동기화 on/off
- `PIM_BASE_URL`: 예) `http://localhost:3001`
- `PIM_API_KEY` (옵션)

### 테스트 방법

사전: WMS 서버 실행(포트 3000 가정), 필요시 PIM 서버(포트 3001 가정)

1) PIM 비활성(오프라인) 경로
   - 환경: `PIM_SYNC_ENABLED=false`
   - 마스터 생성
```bash
curl -X POST http://localhost:3000/wms/masters \
  -H 'Content-Type: application/json' \
  -d '{
        "name":"T-Shirt",
        "masterCode":"TSHIRT-001",
        "optionSchema":{
          "options":[
            {"name":"color","values":["red","blue"]},
            {"name":"size","values":["M","L"]}
          ]
        }
      }'
```
   - SKU 생성(옵션 조합)
```bash
curl -X POST http://localhost:3000/wms/masters/{masterId}/generate-skus
```

2) PIM 활성(온라인) 경로
   - 환경: `PIM_SYNC_ENABLED=true`, `PIM_BASE_URL=http://localhost:3001`
   - 마스터 생성(동일)
   - 수동 동기화 트리거(선택)
```bash
curl -X POST http://localhost:3000/wms/masters/{masterId}/pim-sync
```
   - 기대: PIM에 마스터/변형 생성, WMS에 Variant 기준 `product_matchings` pending 행 생성

### 현재 한계/향후 작업

- 매칭 확장: `ProductMatchingService`에 masterId/옵션 전략 활용 고도화(Resolve/Lookup 정비)
- 세트 마스터: 기존 SKU 조합 기반 세트 구성/매칭 생성
- 실패 보상 E2E: PIM 실패/부분 성공/타임아웃 시 보상 로직 테스트 보강
- 관측성: 동기 호출 성공률, 보상율, 지연 시간 메트릭 기록

### 변경 영향

- 기존 SKU/매칭 CRUD는 유지 및 호환
- 마스터 기반 생성은 점진 도입 가능(기존 데이터는 마스터 없이도 동작)

### 원자재(Material) 처리

- 목적: 판매용이 아닌 자재/부자재 등 재고만 관리
- 생성/관리: WMS에서 `SKU`만 생성/관리(바코드/공급사/카테고리 포함). 마스터를 쓰는 경우 `purpose=material`, `optionSchema`는 비워둠
- 매칭: 판매 목적이 아니므로 `product_matchings` 생성 없이 단독 운용 가능
- PIM 동기화: 비활성. 운영 플래그가 켜져 있어도 `purpose=material`이면 PIM 호출을 생략하도록 가드 가능
- 관련 API: `POST /wms/inventory/skus`(단일 SKU), 필요 시 `POST /wms/masters`(분류 용도) 후 수동 SKU 생성 및 링크

### 커스텀: SKU 레이어 직접 접근과 조회 일관성

- 직접 접근: 상위 레이어(마스터/세트/옵션) 없이도 `InventoryController/Service`의 SKU/바코드 CRUD를 자유롭게 사용 가능
- 결과 일관성: 매칭 현황/조회는 `product_matchings` + `product_variant_sku_links`(+ 필요 시 `product_option_matchings`) 기준으로 동작하므로, 수동 생성 SKU든 마스터 파생 SKU든 동일하게 조회됨
- 제약/주의: 
  - 트랜잭션 규칙 준수(`tx?: DbTx` + `inTx`)
  - 유니크: `skus.code`, `sku_barcodes.barcode` 중복 금지, 매칭/링크 PK 고유성 보장
  - 정책 위치: 판매/선판매/사은품 등의 정책은 `product_matchings`에 귀속(스키마 이전으로 `skus`가 아님)


