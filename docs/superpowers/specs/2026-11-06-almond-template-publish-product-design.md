# 아몬드템플릿 게시 = 템플릿 전용 판매 상품 만들기

작성일 2026-11-06. 화면 시안: 비공개 아티팩트 "아몬드템플릿 게시 모달 시안".

## 1. 왜

- 고객이 템플릿에서 주문하면 시안과 상관없는 공용 상품 페이지(예: 시술 후 주의사항 카드)로 넘어간다. 상품명·옵션이 시안과 맞지 않는다.
- 와우프레스 자동 발주 매핑이 코드 상수(`wowpress-products.ts`)라 품목을 열 때마다 배포가 필요하다.
- 와우프레스 OPEN API 는 성공 응답인데 값을 조용히 무시하는 필드가 있어(도수 `colorno`, 수량 `ordqty`), 사람이 손으로 매핑을 쓰면 틀린다.

## 2. 결정

- 템플릿 하나 = 상품 하나. 어드민에서 게시하기를 누르면 바로 공개하지 않고 모달에서 그 템플릿 전용 상품을 만든 뒤 공개한다.
- 옵션은 와우프레스에서 실시간으로 불러와 고른다. 고른 조합이 그대로 자동 발주 매핑이 된다.
- 판매가는 원가의 몇 배로 정한다(칩 2배·2.5배·3배·직접). 100원 단위 올림. 직접 고친 칸은 배수를 바꿔도 유지한다.
- 멤버십 할인은 템플릿마다 고른다(없음·5%·10%). 멤버십가는 판매가에서 할인 후 100원 단위 내림.

## 3. 화면 (3단계 모달)

1. 상품: 상품명·한 줄 설명은 템플릿에서 미리 채운다. 인쇄 종류, 와우프레스 제품, 배송비 그룹, 파일 형식·재단 여유는 읽기 전용으로 보여 준다.
2. 옵션·가격: 용지·면·수량 칩 → 조합 표 자동 생성(만들 수 없는 조합은 칩 단계에서 숨김). 필수 후가공은 기본값을 골라 둔다. 판매가 배수 칩, 멤버십 할인 칩. 표 열은 원가·판매가·멤버십가(할인 있을 때만)·원가의 몇 배. 행 체크로 조합을 뺄 수 있다.
3. 확인: 고객 목록 카드 미리보기(최저가 "부터"), 조합 수·가격 범위·배수 범위. 판매가(할인 시 멤버십가)가 원가 이하인 조합이 있거나 원가를 못 불러온 조합이 있으면 게시 버튼을 막는다.

모달을 닫아도 입력은 브라우저에 임시 저장하고 다시 열면 이어 한다.

## 4. 데이터 흐름

```
admin 모달 ─①─▶ core GET  /admin/print-catalog/:kind/options     (와우프레스 prod_info → 축·제약·기본값)
          ─①─▶ core POST /admin/print-catalog/:kind/quotes     (조합별 견적, 엄격 판정)
          ─②─▶ core POST /admin/print-catalog/publish     (한 트랜잭션: 상품·가격·매핑·공개)
          ─③─▶ ugc  PUT  /admin/almond-templates/:id/product (템플릿에 상품 연결 + 공개, 멱등)
```

### 4.1 종류별 와우프레스 제품 표 (코드 상수, core)

| 종류 | 와우프레스 제품 | 비고 |
|---|---|---|
| 종류 | 와우프레스 제품 | 파일 | 후가공·도수 (2026-11-13 견적 API 실측) |
|---|---|---|---|
| card·bizcard | 40073 일반명함 | PDF | 후가공 없음. 세로 50×90 은 박 후가공 불가. 뒷면 있는 템플릿은 단면 도수를 내지 않는다 |
| nail | 40073 비규격 90×90 | PDF | `wsize`/`hsize`. 후가공 없음 |
| pet | 40106 PET배너 | JPG | 쿨코팅·아일렛 둘 다 필수(사이트에서는 선택처럼 보여도 API 는 빠지면 `상품 필수 후가공 체크 에러`). 기본 단면무광 쿨코팅·아일렛 4개 |
| mini | 40162 미니 투명배너 | EPS | 사방타공 필수, 기본 있음(거치대용). `단면 칼라+백색`(1355)은 화이트 레이어가 든 AI·EPS 가 필요해 뺀다 |
| window | 40115 일반현수막 비규격 | JPG | 바깥 묶음이 radio 라 후가공 하나 이상 필수(`1개 후가공 필수 선택입니다`). 열재단(사방) 11411 만 넣는다. 나무+로프·아일렛 없이 접수된다 |
| menu | 40164 포맥스보드 | EPS | 후가공 없음(보드타공은 선택). 규격 사이즈만 접수. 297×420 은 A3(5677) |
| diploma | 없음 | 모달 대상에서 뺀다. 수동 처리 |

편집기 재단 여유는 지금처럼 종류별 `PRINT_SPECS[kind].bleedMm` 이다. 모달은 그 값과 prod_info 의 `cutsize ÷ 2` 가 다르면 게시를 막고 이유를 보여 준다(파일 크기가 와우프레스 작업 크기와 어긋나면 발주가 안 된다).

#### 4.1.1 파일 형식 (방울이·API 담당자 답변)

- 와우프레스 상품 페이지의 접수 파일 안내가 기준이다. 미니 투명배너 40162·포맥스보드 40164 는 AI·EPS 만 받는다(2026-11-13 방울이). JPG 는 접수되지 않는다.
- 우리 EPS 는 Ghostscript 로 만든다. 와우프레스는 비어도비 EPS 를 받아도 문제 시 책임지지 않는다고 했으니, 이 두 종류는 게시 전 실주문 테스트가 필요하다.
- 일반 미니배너 40105 는 사이트에서는 팔지만 API 는 `생산되지 않는 제품입니다` 로 거절한다(2026-11-13). 미니배너는 40162 로 둔다.

### 4.1.2 종류별 판매가 (2026-11-13 확정, 원가 = 와우프레스 청구가 부가세 포함)

| 종류 | 판매 옵션 | 원가 예 | 판매가 |
|---|---|---|---|
| bizcard·card 90×50 | 무코팅250·무광코팅250 / 단면·양면 / 500·1,000매 | 무코팅 양면 500매 4,510 | 무코팅 단면 12,900·18,900 / 무코팅 양면 15,900·24,900 / 무광250 양면 17,900·27,900 (500·1,000매) |
| nail 90×90 | 무코팅250·무광코팅250 / 단면·양면 / 500·1,000매 | 무코팅 단면 500매 6,820 | 무코팅 단면 19,000·29,000, 양면 +4,000, 무광250 +3,000 |
| pet 60×180 | 1·2·3개 | 1개 8,470 | 32,000 / 59,000 / 85,000 |
| mini 15×30 | 1·2·5개 | 1개 4,840 | 15,000 / 27,000 / 59,000 |
| mini 18×42 | 1·2·5개 | 1개 5,060 | 19,000 / 34,000 / 75,000 |
| window 60·80·100cm | 1·2개 | 6,974 / 7,502 / 8,030 | 19,000 / 22,000 / 25,000, 2개는 1.8배 |
| menu A5·A4·A3 포맥스 3T | 1·2개 | 6,710 / 9,240 / 12,760 | 22,000 / 30,000 / 42,000, 2개는 1.8배 |

멤버십 할인은 없다. 배송비 그룹은 게시 뒤 따로 붙인다(card·bizcard·nail `print-card`, mini `print-mini`, pet·window `print-sign`, menu `print-board`). 거치대 같은 부자재는 팔지 않는다(§7). 메뉴 속지 템플릿은 종이 인쇄라 포맥스로 게시하지 않고 예전 상품에 둔다.

## 4.2 와우프레스 요청 바디 규칙 (2026-11-06 실측)

- prsjob 원소: `covercd`, `sizeno`(비규격이면 `wsize`·`hsize`), `paperno`, `colorno0` 와 `colorno`(같은 값), `jobno`, `jobqty = 총수량`.
- awkjob 원소: `covercd`, `jobno`, `jobqty = 총수량`.
- 최상위: `ordqty = 총수량`(문자열), `ordcnt = '1'`.
- 견적 판정: 최상위 `status == 200`, prsjob 모든 원소 `status == 200`, awkjob 모든 원소 `status == 200` 이고 `jobcostno > 0`, 돌려받은 `jobqty`·`colorno0`·`wsize`/`hsize` 가 보낸 값과 같아야 옳은 견적이다.
- 제약: 그룹 type `radio` 는 정확히 하나 필수, 바깥 awkjobinfo type `radio` 는 그룹 하나 이상 필수(어느 그룹인지는 종류 표의 `awkDefaults` 로 정한다). 그룹 type `select` 는 선택이다. `rst_*` 는 금지 조건, `req_*` 는 함께 필요한 값. 수량 목록은 ordqty 배열의 조건(sizeno·paperno·colorno)별 목록을 쓴다.

### 4.3 게시 (core, 한 요청)

- 새 경로 `POST /admin/print-catalog/publish` 가 기존 상품 생성 로직을 한 `dbService.run` 안에서 재사용한다: `ProductMastersService.createMaster` → `updateVersion`(이름·설명·썸네일·optionDiff) → 조합→variant 해석 → `PricingService.replaceVersionRules` → `ProductVersionsService.publishVersion`. 선례는 `BulkDraftApplier.applyCreate`. 어드민이 기존 상품 API 를 여러 번 순차로 부르지 않는다.
- 상품과 발주 매핑 테이블을 함께 쓰므로 게시 서비스는 `DbService<MergedSchema>` seam 이다(ADR-0025).
- 서버는 받은 조합을 다시 견적해 판매가·멤버십가가 원가보다 큰지 확인한다. 화면 검사만 믿지 않는다.
- 옵션 그룹은 고른 축(용지·면·수량 등)으로 만들고 variant 는 조합마다 하나.
- 판매가·멤버십가는 버전 가격 룰로 쓴다: order 1 `all_variants` override(최저 판매가) + variant 마다 `variants` override, 멤버십은 `membership_price` 레이어. 공개 때 가격 캐시와 Medusa variant metadata(`membershipPrice`)가 함께 갱신된다.
- 대표 이미지: ugc 가 템플릿 미리보기 JPG 를 file-service 에 올려 받은 fileId 를 `thumbnailFileId` 로 쓴다.
- 상품에 템플릿 정보를 싣지 않는다. 버전에 임의 metadata 칸이 없고 Medusa 동기화 경로 다섯 곳을 고쳐야 하기 때문이다. 템플릿↔상품 연결은 ugc 템플릿의 `product_id` 하나가 정본이다.
- 같은 템플릿으로 두 번 게시하지 않도록 core 에 `print_template_products(template_id PK, master_id)` 를 두고 같은 트랜잭션에서 쓴다.
- 자동 발주 매핑을 새 테이블에 조합마다 한 줄 저장한다(4.4).
- 같은 템플릿으로 이미 만든 상품이 있으면 새로 만들지 않고 그 master id 를 `created:false` 로 돌려준다(③만 다시 하면 된다).
- 권한: 라우트는 `@RequirePermission('catalog.product.write')`, 나머지 `catalog.price.write`·`marketing.almond_template.write` 는 `PermissionCheckpoints.check` 로 확인한다(데코레이터는 한 키만 받는다).

### 4.4 자동 발주 매핑 테이블 (core, additive)

`print_product_specs`
- `variant_id` PK (PIM variant id = 판매주문 라인 variant_id)
- `prodno`, `jobpresetno`, `prsjob` jsonb, `awkjob` jsonb, `qty_per_unit`, `file_format`, `file_dpi`
- `design_product_id`, `design_width_mm`, `design_height_mm`
- `confirmed` boolean (처음엔 false), `confirmed_at`, `confirmed_by`
- `created_at`, `updated_at`

`PrintOrderSubmitManager` 는 이 테이블을 먼저 보고, 없으면 기존 상수 `WOWPRESS_PRODUCTS` 를 본다. 상수의 22개 variant 는 배포 때 테이블로 옮기고 다음 PR 에서 상수를 지운다(expand → contract). 어드민 와우프레스 보드의 테스트 확인대기 "확인 완료"가 그 주문 라인의 variant 행 `confirmed` 를 true 로 바꾼다(지금은 print_orders 행만 표시한다).

### 4.5 템플릿 연결 (ugc)

- `PUT /admin/almond-templates/:id/product { productId }` 가 `product_id` 컬럼과 `design.productId` 를 함께 바꾸고 `published` 로 만든다. 같은 값으로 다시 불러도 결과가 같다. unique(product_id, 크기, 제목) 충돌은 409.
- `POST /admin/almond-templates/:id/preview-image` 가 미리보기 JPG 를 file-service 에 올리고 fileId 를 돌려준다(게시 ② 전에 부른다).
- 게시 ②는 성공했는데 ③이 실패하면 모달에 "게시 마무리 다시 시도"를 보여 준다. 상품은 만들어졌지만 템플릿이 안 걸린 상태라 고객 갤러리에는 아직 안 보인다.

### 4.6 스토어프론트

- 상품이 템플릿 상품인지는 `PRINT_PRODUCTS` 에 더해, ugc 공개 템플릿 목록에 그 상품(masterId)을 가진 템플릿이 있는지로 판단한다. 종류는 템플릿의 `kind` 다. 상품 상세·편집기 진입·고객 갤러리 필터가 모두 이 판단 하나를 쓴다.
- 템플릿 편집기의 주문하기는 그 템플릿의 상품 상세로 간다.

## 5. 오류 처리

- 와우프레스가 응답하지 않거나 판정에 실패한 조합은 원가 칸에 "견적 실패"로 표시하고 그 조합을 게시에서 막는다(재시도 버튼).
- 게시 요청은 멱등 키(템플릿 id)로 중복 생성을 막는다.
- ③ 실패는 위 4.5.

## 6. 테스트

- core: 바디 생성 규칙(colorno0·jobqty·비규격), 견적 판정(무시 필드·jobcostno -1·status 900), 제약 해석(radio·rst·req), 게시 트랜잭션(중간 실패 시 아무것도 안 남음, 중복 409), 매핑 테이블 우선·상수 대체.
- ugc: 연결 경로 멱등.
- admin-web: 모달 상태(배수 변경 시 직접 고친 칸 유지, 멤버십가 계산, 게시 막힘 조건).
- storefront: 템플릿 목록 기반 판단(새 상품·기존 6종 모두), 갤러리·편집기 진입.

## 7. 하지 않는 것

- 게시 이후 가격·옵션 수정 화면(기존 상품 수정 화면을 쓴다).
- 디플로마.
- 부자재(거치대·큐방·케이스) 판매. 다음 단계.

## 8. 배포 순서

모두 additive 라 expand 순서다: core 마이그(`print_product_specs`, `print_template_products`) → core·ugc 배포 → 22개 variant 옮기기(배포 때 라이브 데이터 삽입) → admin-web → storefront.

## 9. 열린 질문

- 와우프레스 문의 대기: 40162·40181 관계, 주문 API 의 생산 수량이 jobqty 기준인지. (미니배너 JPG 는 2026-11-13 불가로 확인, §4.1.1)
- Ghostscript EPS 가 미니 투명배너·포맥스보드에서 실제로 접수되는지 실주문으로 확인한다.
- 메뉴판을 포맥스와 코팅 포스터 중 어느 쪽으로 기본값을 둘지(템플릿 크기 A5 는 포맥스만 가능).
