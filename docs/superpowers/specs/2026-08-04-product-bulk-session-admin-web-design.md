# 상품 일괄 등록/수정 세션 — admin-web 화면 단계 설계 스펙

- 날짜: 2026-08-04
- 대상: `apps/admin-web` (+ `apps/core` 소폭 3건)
- 상태: **설계 확정, 구현 미착수**
- 관련:
  - `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` (본 스펙의 **모체**. 아래 §표기는 전부 그 문서를 가리킨다)
  - `docs/adr/0004-variant-draft-scoped-edit-cow.md` (버전 CoW)
  - `docs/adr/0005-drizzle-migration-and-autodeploy.md` (마이그레이션 순서 — 이 단계는 마이그레이션 0건이라 해당 없음)

## 1. 목표

모체 스펙의 1~6단계는 **core 백엔드만** 구현했다(§10.1·§11.1, 사용자 결정). 그 결과 지금 라이브에는 **대량등록의 UI 경로가 없다** — 옛 `/mall/product-imports` 위저드는 6단계가 걷어냈고(`edddc8573`), 새 세션 화면은 아직 없다. 살아있는 admin-web 자산은 상품 목록의 「양식 다운로드」 모달 하나뿐이다.

이 스펙은 그 공백을 닫는다. 작업자가 **양식 다운로드 → 오프라인 편집 → 업로드 → 검토·충돌 해소 → 이미지 업로드 → draft 검토 → 일괄 발행**을 화면만으로 완주할 수 있게 만든다.

## 2. 현재 상태 실측 (2026-08-04, `f313649d3`)

### 2.1 core 가 이미 제공하는 것

두 컨트롤러 모두 `@UseGuards(RolesGuard('master', 'admin'))` 이다.

| 라우트 | 용도 |
|---|---|
| `POST /product-forms` | 양식 생성 접수(202). `masterIds` 필수·비어있을 수 없음 |
| `GET /product-forms/:exportId` | 상태 폴링 |
| `GET /product-forms/:exportId/download-url` | 완성 파일 URL |
| `POST /product-bulk-sessions` | 워크북 업로드 접수(202, multipart). 상한 10MB(`MAX_UPLOAD_BYTES`) |
| `GET /product-bulk-sessions` | 내 세션 목록(페이지) |
| `GET /product-bulk-sessions/:id` | 진행률 — `phase`·`itemTotal`·`itemCounts`·`imageCounts`·`publishCounts` |
| `GET /product-bulk-sessions/:id/items` | 행 목록. `status` 필터·페이지(최대 100) |
| `PATCH /product-bulk-sessions/:id/items/:itemId/conflict-decision` | 필드별 결정. 부분 갱신(머지) |
| `POST /product-bulk-sessions/:id/approve` | `review` → `awaiting_images`\|`drafting` |
| `POST /product-bulk-sessions/:id/cancel` | 진행 중 phase → `canceled`. `failed` 도 대상 |
| `POST /product-bulk-sessions/:id/publish` | `drafted`·`published`. 최초 발행과 실패 행 재발행을 겸한다 |
| `POST /product-bulk-sessions/:id/retry-draft` | `drafted`. draft 생성 실패 행만 되돌린다 |
| `POST /product-bulk-sessions/:id/items/:itemId/exclude` | 행 제외 + 그 draft 잠금 해제. 되돌릴 수 없다 |
| `POST /product-bulk-sessions/:id/purge-drafts` | `canceled` 뿐. 한 요청 최대 100행 |
| `GET /product-bulk-sessions/:id/images` | 요구 이미지 목록 + `requiredTotal`/`requiredResolved` |
| `POST /product-bulk-sessions/:id/images/resolve` | `(imageKey, usage, fileId)` 통보. 한 요청 최대 50건 |

**즉 화면이 필요로 하는 라우트는 이미 전부 있다.** 이 단계가 core 를 건드리는 것은 §2.3 의 갭 3건 때문이지 라우트가 모자라서가 아니다.

### 2.2 admin-web 에 남은 것

| 자산 | 위치 |
|---|---|
| 「양식 다운로드」 모달 | `features/mall/products-list/components/form-export-modal/` |
| 양식 잡 훅·폴링 헬퍼 | `lib/services/products/form-export.ts` |
| 양식 API 클라이언트 | `lib/api/domains/products/form-export.client.ts` |
| 양식 DTO 미러 타입 | `lib/types/dto/form-export.ts` |
| 상품 목록 다중선택(선택 id = **masterId**) | `features/mall/products-list/components/table/index.tsx` |
| draft 편집 경로 헬퍼 | `features/mall/my-drafts/lib/draft-edit-path.ts` |
| file-service 업로드 클라이언트 | `lib/api/domains/files/upload.client.ts` |

옛 위저드가 걷힌 규모는 화면 3 · 피처 8 · 약 1,660줄이다(`edddc8573`). **그 구조를 그대로 되살리지 않는다** — 아래 §3.2 가 다른 형태를 고른다.

### 2.3 화면이 없어 드러나지 않던 갭 3건

세 건 모두 "백엔드만 만들었을 때는 보이지 않던 것"이고, 화면을 붙이는 순간 막힌다.

**① 빈 양식을 받을 방법이 없다.**
`CreateFormExportDto.masterIds` 가 `@ArrayNotEmpty` 다. 그런데 `bulk-session-job.manager.ts:357` 은 *"진짜 빈 양식 업로드는 워크북에도 exportId 가 없어 이 가지에 걸리지 않는다"* 를 정상 경로로 전제한다(§3.1 의 신규 전용 세션). 지금 신규 상품만 대량등록하려면 아무 상품이나 프리필해 받아 행을 지우는 수밖에 없고, 한국어 헤더 7시트를 손으로 만드는 건 불가능하다.

**② 세션 draft 의 잠금이 화면에 보이지 않는다.**
`product_master_versions.bulk_session_id` 는 스키마에 있지만 **어떤 읽기 DTO 도 노출하지 않는다.** 그래서 `getVersionLifecycleActions`(`features/mall/products-detail/components/version-lifecycle-actions/version-lifecycle-actions-model.ts`)는 draft 이기만 하면 「발행」·「삭제」를 띄운다. 작업자가 세션 draft 를 열면 **눌러도 409 로 실패하는 버튼**을 본다(§3.3 이 그 둘을 거부하도록 4단계가 막았다).

**③ 충돌을 서버에서 거를 수 없다.**
`GET :id/items` 의 `status` 는 `pending|invalid|drafted|excluded|failed` 다 — 충돌은 이 축에 없다. 1,240행 세션에 충돌 48건이면 작업자가 13페이지를 넘겨 찾아야 하고, `approve` 의 409 메시지는 미결정 행을 5개까지만 미리보기한다(`bulk-session.manager.ts:340-344`).

### 2.4 admin-web 제약 (부록 A.6 재확인)

| 사실 | 영향 |
|---|---|
| **렌더러가 없다** — `@testing-library/react`·`react-test-renderer` 미설치 | 컴포넌트 배선은 단위 테스트 불가. 판정 로직을 순수 함수로 뽑아야 테스트된다 |
| `.tsx` 는 레포 `lint`/`format` 글롭(`**/*.ts`)을 빠져나간다 | `npx eslint <파일>` 로 직접 봐야 한다 |
| 테스트는 루트에서 `npm run test:admin-web -- <경로>` | `apps/admin-web` 에 jest 설정이 없다 |
| `refetchInterval` 은 v5 의 `(query) => query.state.data` 형태 | `form-export.ts:51` 선례 |
| 전역 query 기본값 `retry: 2`, `refetchOnWindowFocus: false` | `components/providers/query-provider.tsx` |
| 상품 목록 선택 id 는 **masterId** | `products-list/components/table/index.tsx` 의 `getRowId` |

## 3. 설계

### 3.1 core 소폭 변경 3건 (전부 additive · 마이그레이션 0건)

**① `GET /product-forms/blank` — 빈 양식 동기 다운로드**

`buildFormWorkbook`(`form-export.workbook.ts:39`)은 이미 DB·네트워크를 타지 않는 순수 함수이고, 빈 양식에 필요한 유일한 데이터는 카테고리 트리다(`form-export.snapshot.reader.ts:109-112` 가 이미 `getCategoryTree` 로 읽는다). 시트 6개를 빈 채로, 「카테고리 참조」만 채워 즉시 조립해 xlsx 를 그대로 반환한다. 잡 행도 스냅샷도 만들지 않으므로 ALB 60초 안에 넉넉히 끝난다.

**`exportId` 를 심지 않는다.** `PrefillWorkbookData.exportId` 를 `string | null` 로 풀고, null 이면 숨은 `meta` 시트 자체를 만들지 않는다(`form-export.workbook.ts:62-65`). 그래야 §2.3① 이 인용한 매니저의 전제가 실제로 성립한다 — 빈 양식에 `exportId` 를 심으면 30일 만료 뒤 그 워크북이 **업로드 거부**된다(§3.1 의 세 갈래 중 "있는데 해석 안 됨"). 빈 양식은 만료가 없어야 한다.

**② 버전 상세 응답에 `bulkSessionId` 노출**

`GET /products/:masterId/versions/:versionId`(`product-master-versions.controller.ts:68`) 응답에 `bulkSessionId: string | null` 하나. 스키마에는 이미 있고 읽기만 안 하고 있었다.

**③ `GET :id/items` 에 `conflict` 필터**

`conflict=any` 와 `conflict=undecided` 를 받는다. `status` 와 병용 가능하다(AND).

`approve` 가 이미 같은 판정을 한다 — `isNotNull(conflict)` 로 뽑아 메모리에서 `conflictMap` vs `decisionMap` 을 비교한다(`bulk-session.manager.ts:308-338`). 그 술어를 리더로 옮기고 매니저가 리더를 쓰게 한다(판정 로직 두 벌 금지). 페이징은 `getImages` 와 같은 방식이다 — **충돌 행만 SQL 로 뽑아 메모리에서 슬라이스한다.** `undecided` 는 jsonb 두 개의 키 차집합이라 SQL 술어로 내리기 어렵고, 충돌은 §3.6 정의상(작업자가 바꾼 필드 ∩ 남이 바꾼 필드) 드물어 전량 적재가 감당된다. `getImages` 가 같은 트레이드오프를 같은 이유로 이미 택했다(`bulk-session.reader.ts:240-245`).

미결정 개수는 **DTO 를 늘리지 않고** `?conflict=undecided&limit=1` 의 `total` 로 얻는다.

### 3.2 라우팅과 메뉴

```
/mall/bulk-sessions          목록 + [양식 업로드] [빈 양식 다운로드]
/mall/bulk-sessions/[id]     상세 — phase 로 몸통을 갈아끼운다
```

**옛 위저드의 3화면(`목록`/`new`/`상세`) 구조를 계승하지 않는다.** 업로드는 파일 하나·이름 하나라 전용 페이지를 채우지 못하고, 세션은 며칠을 살며 사람이 여러 번 돌아오므로 **URL 이 세션과 1:1** 인 편이 낫다. 돌아왔을 때 같은 주소가 지금 맞는 자리를 보여준다.

메뉴는 `product-management` 그룹의 `product-drafts`(작성중인 상품) 바로 아래:

```ts
{ id: 'product-bulk-sessions', title: '엑셀 일괄 등록/수정', path: '/mall/bulk-sessions' }
```

**「일괄 등록」이 아니라 「엑셀 일괄 등록/수정」인 이유**: 같은 그룹에 이미 `{ id: 'product-bulk', title: '일괄 작업', path: '/mall/bulk' }` 가 있다(정책·액션 일괄 적용 — 모체 §4 가 경계 정리를 별건으로 못 박은 그 화면). 두 이름이 구분돼야 한다.

`breadcrumb-items.ts` 의 `mallProductBreadcrumbs` 에도 같은 라벨로 한 줄 더한다.

두 페이지 모두 `<RouteGuard requireRole={['admin', 'master']}>` 로 감싼다(`my-drafts/page.tsx` 선례). 서버 가드와 같은 롤이다.

상품 목록의 기존 「양식 다운로드」 모달은 **그대로 둔다.** 완료 문구에 이 화면으로 가는 링크만 덧붙인다.

### 3.3 파일 배치

```
lib/types/dto/bulk-session.ts                    미러 타입
lib/api/domains/products/bulk-session.client.ts  세션 라우트 13개
lib/api/domains/products/form-export.client.ts   (기존) + 빈 양식 1개
lib/services/products/query-keys.ts              (기존) + bulkSessions 계열
lib/services/products/bulk-session.ts            쿼리·뮤테이션 훅
lib/services/products/bulk-session-model.ts      ★ 순수 헬퍼 — 유일한 테스트 대상
features/mall/bulk-sessions/
  session-list/
    index.tsx                  목록 표
    upload-modal.tsx           파일 + 이름 → POST 202 → 상세로 이동
  session-detail/
    index.tsx                  phase → 패널 선택
    header.tsx                 이름·phase 배지·진행률·취소
    working-panel.tsx          uploaded·validating·drafting·publishing 공용
    review-panel/              프리뷰 표 + 충돌 해소
    images-panel/              드롭존 + 업로드 풀
    drafted-panel/             행별 결과 + 발행·제외·재시도
    published-panel/           결과 + 실패 행 재발행
    canceled-panel/            purge-drafts 반복
```

§2.4 때문에 **판정 로직은 전부 `bulk-session-model.ts` 의 순수 함수로 뽑고 컴포넌트는 배선만 한다.** 컴포넌트 안에 남은 조건문은 테스트되지 않는 코드라는 뜻이다.

### 3.4 폴링과 진행률

폴링 대상은 `GET :id` 하나다. 인터벌은 phase 가 정한다.

| phase | 인터벌 |
|---|---|
| `uploaded`·`validating`·`drafting`·`publishing` (워커 차례) | 2000ms |
| `review`·`awaiting_images`·`drafted`·`published`·`canceled`·`failed` | `false` |
| `undefined` (첫 응답 전) | **2000ms** |

마지막 줄이 중요하다 — `formExportRefetchInterval`(`form-export.ts:15-20`)이 같은 이유로 같은 선택을 했다. `undefined` 를 멈춤으로 읽으면 첫 요청이 한 번 실패했을 때 화면이 마운트 내내 굳는다.

목록 화면도 같은 규칙이다 — 페이지 안에 워커 차례인 세션이 하나라도 있으면 2초, 없으면 멈춘다.

**진행률 분모는 `itemTotal` 이고 `totalRows` 가 아니다.** DTO 가 명시적으로 경고한다 — `totalRows` 는 "상품" 시트 데이터 행 수라 합성 아이템(고아 참조 등)이 빠져 아이템 수와 어긋난다. 이미지 게이트만 분모가 다르다: `requiredResolved / requiredTotal` 이며, 이 둘은 **필터와 무관하게 세션 전체 기준**이라 페이지를 넘겨도 변하지 않는다.

### 3.5 목록 화면과 업로드

목록 열: 이름 · 파일명 · phase 배지 · 행 수 · 생성일. 행 클릭 → 상세.

업로드 모달은 파일 + 이름(선택). 클라이언트에서 10MB 를 미리 거른다(서버 상한과 같은 값을 상수로 미러). 202 응답의 `sessionId` 로 상세로 이동한다.

**400 을 특별 취급한다.** 「해석할 수 없는 양식」은 만료된 `exportId` 를 든 워크북이라는 뜻이므로 다음으로 옮긴다:

> 양식이 만료되었습니다. 상품 목록에서 양식을 다시 받아 작성해 주세요.

§3.1 이 *"선택이 아니라 이 오버라이드가 만든 필수 조건"* 이라고 못 박은 방어선이 사람에게 드러나는 유일한 자리다. 원문 예외 텍스트를 그대로 띄우면 작업자는 자기가 뭘 해야 하는지 알 수 없다.

「빈 양식 다운로드」는 `GET /product-forms/blank` 를 새 탭으로 연다. 폴링도 잡도 없다.

### 3.6 review 패널

필터 탭 4개가 **전부 서버 필터**다.

| 탭 | 쿼리 |
|---|---|
| 전체 | (없음) |
| 정상 | `status=pending` |
| 오류 | `status=invalid` |
| 충돌 | `conflict=any` |

헤더에 미결정 개수를 고정 표시하고(`?conflict=undecided&limit=1` 의 `total`), 0 이 아니면 「승인」을 비활성화한다.

행을 펼치면 `changes`(필드 라벨 · 전 → 후)와 `conflicts` 가 그 자리에 나온다. **서버가 한국어 라벨을 이미 붙여 주므로 화면은 렌더만 한다** — `toItemDto` 가 `fieldLabel(field)` 로 워크북 헤더 라벨을 실어 보낸다(`bulk-session.reader.ts:315`). 라벨 매핑을 화면에 두 번째로 두지 않는다.

충돌 필드마다 라디오 둘(`내 값` / `현재 값`)이고 **기본 선택이 없다.** 서버가 기본값을 정하지 않는 이유가 화면에도 그대로 적용된다 — §3.6 은 *"덮어쓰기를 고르는 건 항상 남의 편집을 되돌리는 결정"* 이라고 적었다. 「현재 값」 쪽에 `(남이 바꿈)` 표기를 붙인다. 선택 즉시 `PATCH` 하고, 응답이 `BulkSessionItemDto` 라 재조회 없이 그 행만 캐시 교체한다.

**오류 행이 남아 있어도 승인은 된다.** `approve` 는 `status='pending'` 행만 보므로 `invalid` 행은 조용히 빠진다(`bulk-session.manager.ts:318`). 그래서 승인 확인창이 이걸 명시한다:

> 오류 12건은 제외하고 1,180건을 진행합니다.

이 문구가 없으면 작업자는 오류 행이 나중에 처리되는 줄 안다.

`invalid` 행은 `errorMessage` 를 그대로 보여주고 결정 UI 를 달지 않는다.

### 3.7 images 패널

요구 목록은 `?onlyRequired=true&status=awaiting_upload` 다. 게이트 표시는 응답의 `requiredResolved / requiredTotal` 이다.

드롭존은 폴더(`webkitdirectory`)와 파일 다중 드롭을 모두 받는다. 매칭은 basename 기준 소문자·트림이다(§3.9: 대소문자 무시, 앞뒤 공백 제거).

**작업 큐의 단위는 파일이 아니라 행이다.** 같은 파일명을 `main` 과 `description` 이 각각 요구하면 `contextId` 가 달라 같은 파일을 두 번 올린다(§3.9: "한 키가 양쪽에 쓰이면 컨텍스트가 달라 두 번 올라간다"). 각 행이 쓸 `contextId` 는 서버가 `BulkSessionImageDto.contextId` 로 내려준다.

- 동시 업로드 **5개**로 제한한다. 수백 장을 한꺼번에 던지면 브라우저 커넥션 한도와 프록시가 막는다
- 업로드는 `uploadFileToFileService(file, { contextId: row.contextId })` — 기존 클라이언트를 그대로 쓴다. "브라우저 직접"은 **core 를 경유하지 않는다**는 뜻이지 file-service 오리진을 때린다는 뜻이 아니다(부록 B, `/api/proxy/file` 경유)
- 성공분을 **50개씩** `POST :id/images/resolve` 로 보낸다
- **결과 짝짓기는 인덱스가 아니라 `(imageKey, usage)` 로 한다.** DTO 가 명시 경고한다 — 같은 키 중복은 마지막 것만 남아 응답 길이가 요청보다 짧을 수 있다

실패는 두 종류(업로드 실패 · `ok:false`)를 한 목록에 모으고 「실패한 것만 다시 시도」를 단다. `ok:false` 의 `error` 는 서버가 작업자용 문구로 내려주므로 그대로 쓴다. 매칭 안 된 파일도 따로 보여준다(무시하되 알린다 — §3.9).

resolve 응답의 `progress.phase === 'drafting'` 이면 전량 게이트가 열린 것이라 패널을 바꾼다. 별도 폴링을 기다리지 않는다.

새로고침하면 서버 상태가 다시 기준이 된다. 브라우저는 파일 핸들을 들고 있을 수 없으므로 남은 것만 다시 떨구면 된다 — 이미 `resolved` 된 행은 목록에서 사라져 있다. 업로드 중 이탈에는 `beforeunload` 경고를 단다.

### 3.8 drafted · published · canceled · failed 패널

**drafted**

행 표에 `status` 필터(`drafted`/`failed`/`excluded`)와 `publishStatus` 배지를 단다 — 두 축이 다르다는 걸 DTO 가 경고한다(한 행이 `drafted` 이면서 `publishStatus='failed'` 일 수 있다).

행마다:
- draft 편집 링크 — `buildDraftEditPath(masterId, draftVersionId)` 재사용, 새 탭
- 제외 버튼 — **되돌릴 수 없으므로** 확인창. 「제외한 행은 다시 넣을 수 없습니다. 풀린 draft 는 작성중인 상품 목록에 나타납니다」
- `masterId` 가 null 인 실패 행(신규 생성 자체가 실패)은 링크가 없다

액션 둘:
- `[일괄 발행]` → `POST :id/publish`
- 실패 행이 있으면 `[draft 실패 행 재시도]` → `POST :id/retry-draft`

**재시도 버튼에는 경고가 붙는다.** 신규 행은 재시도할 때마다 `createMaster` 가 트랜잭션 밖으로 내는 부수효과 둘(Kafka 직송 `ProductVariantCreated` 이벤트 + 별도 커넥션의 `product_matchings` 행)이 **누적된다**(§5.1 정정, §10.5). 근본 수정은 catalog core 전체에 걸리는 별건이고 사용자 결정은 현상 유지다. 문구가 "무한정 누를 버튼이 아니다"를 말해야 한다:

> 실패한 행만 다시 처리합니다. 신규 상품 행은 재시도할 때마다 내부 등록 기록이 한 번 더 쌓이므로, 원인을 확인한 뒤 눌러 주세요.

**published**

성공·실패 집계와 실패 행의 `publishError`. 서버가 이미 한국어로 분류해 내려주므로(§10.7 의 `errorMessage` 분류기) 그대로 렌더한다. `[실패 행 재발행]` 은 **같은** `POST :id/publish` 다 — 라우트가 최초 발행과 재발행을 겸한다. 제외도 이 단계에서 계속 열려 있다.

**세션이 `published` 여도 실패 행은 남아 있을 수 있다**(§10.4: "실패 행이 남아도 `phase='published'` 로 마감한다"). 화면이 "완료"만 크게 띄우면 그 행들이 묻힌다 — 실패 수가 0 이 아니면 완료 문구보다 실패 블록이 위에 온다.

**canceled**

`[남은 draft 정리]` 가 `purge-drafts` 를 반복 호출한다. 종료 조건은 `remaining === 0` **또는 `purged === 0`** 이다 — 후자가 없으면 영구 실패 행 앞에서 무한 루프가 된다(부록 D.5 의 정정). 누적 `purged`/`failed` 를 진행 표시로 보여준다.

패널에 정리 규칙을 명시한다: 「발행된 적 있는 행과 제외된 행은 건드리지 않습니다. 수정 행은 임시 버전만, 신규 행은 상품까지 함께 지웁니다.」(§3.12)

**failed**

`phaseError` 와 `[세션 취소]` 뿐이다. **재개는 없다** — §3.2 가 `failed` 를 "취소로만 풀린다"로 정의했다. 재시도 버튼을 두면 그 정의를 화면이 어긴다.

### 3.9 상품 상세의 잠금 배너

`bulkSessionId` 가 있으면 `getVersionLifecycleActions` 가 `canPublish`·`canDeleteDraft` 를 모두 false 로 돌린다. 입력을 `VersionLifecycleDetail` 에 필드 하나 더하는 것으로 확장하고, 기존 spec 에 케이스를 추가한다.

배너는 세션 조회를 한 번 시도한다(`retry: false`):

| 결과 | 표시 |
|---|---|
| 성공 | 「일괄 세션 **‹이름›** 에 속한 임시 버전입니다. 발행·삭제는 세션에서 합니다.」 + 세션 링크 |
| 404/403 | 「다른 작업자의 일괄 세션에 속한 임시 버전입니다. 발행·삭제는 그 세션에서 합니다.」 (링크 없음) |

세션 API 는 소유자 스코프라 남의 세션은 애초에 못 연다. 링크를 무조건 걸어놓고 클릭했을 때 404 로 보내는 것보다, 조회해 보고 없으면 링크를 안 거는 편이 정직하다.

**편집은 그대로 열린다** — §3.3 이 세션 draft 의 편집을 허용으로 두었다("통상의 draft 처럼 검토·수정"이 목적).

### 3.10 오류 처리 규약

- 기존 `parseServerError`(`lib/api/server-error.ts`)를 쓴다
- **409 는 대부분 "phase 가 이미 넘어갔다"** 이다(워커가 그 사이 전진시킴). 진행률 쿼리를 무효화해 화면을 갱신하고 「세션 상태가 바뀌었습니다. 새 상태를 불러왔습니다」로 안내한다. 실패 토스트만 띄우고 화면을 그대로 두면 작업자가 같은 버튼을 계속 누른다
- **403** 은 롤 문제다 — 「이 기능은 admin·master 권한이 필요합니다」. §9 의 배포 선행조건이 안 지켜졌을 때 나온다
- 404 는 「세션을 찾을 수 없습니다」 후 목록으로

## 4. 하지 않는 것

- **세션 이름 편집** — 서버에 라우트가 없다. 필요하면 별건
- **다른 사람의 세션 조회** — API 가 소유자 스코프다. 관리자 전체 조회는 별건
- **옛 `/mall/bulk`(일괄 작업)와의 경계 정리** — 모체 §4 가 이미 별건으로 못 박았다
- **브라우저 안 워크북 미리보기·편집** — 엑셀에서 작업한다는 것이 이 기능의 전제다
- **양식 잡 목록 화면** — 잡은 30일 만료 임시물이고 모달 하나로 충분하다
- **`purge-drafts` 자동 실행** — 취소된 세션에서만 열리는 명시적 관리자 동작이다(§3.12)

## 5. 알려진 결함

### 5.1 이 스펙이 없애는 것

- **대량등록 UI 경로 부재**(§11.1) — 이 스펙의 존재 이유
- **빈 양식을 받을 방법 없음** — §3.1①
- **세션 draft 에서 눌러도 실패하는 버튼** — §3.1②
- **1,000행 세션에서 충돌 행을 찾을 방법 없음** — §3.1③

### 5.2 남는 것

- **`beforeunload` 는 업로드 중 이탈을 막지 못한다** — 경고만 띄운다. 이탈해도 이미 `resolved` 된 것은 서버에 남고 나머지는 다시 떨구면 되므로 데이터 손실은 없다
- **이미지 매칭이 basename 충돌을 구분하지 못한다** — 서로 다른 폴더의 동명 파일을 함께 떨구면 뒤엣것이 이긴다. 워크북이 파일명만 받으므로(§3.9) 구조적 한계다. 화면이 "같은 이름의 파일이 둘 이상 있습니다"를 알린다
- **`purge-drafts` 반복 중 탭을 닫으면 중단된다** — 멱등하므로 다시 눌러 이어간다
- **`retry-draft` 의 부수효과 누적** — §3.8. catalog core 별건이라 문구로만 방어한다
- **미결정 개수를 위해 쿼리가 하나 더 돈다** — 진행률 DTO 를 늘리지 않기로 한 대가다. 폴링 대상이 아니라 review 진입·결정 후에만 돈다

## 6. 구현 전 확인할 전제

- **`buildFormWorkbook` 이 빈 배열로 정상 조립되는가.** `addSheet` 는 헤더를 먼저 쓰고 rows 를 순회하므로 구조상 문제없어 보이지만, `reference.protect('')` 와 `views` 고정이 데이터 0행에서도 왕복을 견디는지 구현 시 실측한다(부록 A.7 이 exceljs 왕복 손실을 기록해 두었다)
- **`GET /products/:masterId/versions/:versionId` 의 응답 조립 지점**이 버전 행을 통째로 실어 보내는지, 필드를 골라 담는지 확인한다. 후자면 `bulkSessionId` 를 명시적으로 추가해야 한다
- **`RolesGuard` 가 보는 `roles` 클레임에 실제 MD 계정이 `admin`·`master` 를 갖고 있는가** — §10.7 이 남긴 미해소 선행조건이고, 화면이 열리면 즉시 드러난다(§9)

## 7. 커밋 분할

한 브랜치, 계층순 5개. 각 커밋이 그 계층에서 컴파일되는 상태를 유지한다.

| # | 내용 |
|---|---|
| 1 | **core 3건** — 빈 양식 라우트 · `bulkSessionId` 노출 · `conflict` 필터(+매니저가 리더를 쓰게 정리) |
| 2 | **admin-web API·타입·모델 배선** — 미러 타입 · 클라이언트 · 쿼리키 · 훅 · `bulk-session-model.ts` + 그 spec |
| 3 | **목록 + 업로드 모달** — 라우트 하나가 살아난다 |
| 4 | **상세 패널 전부** — header · working · review · images · drafted · published · canceled |
| 5 | **메뉴·breadcrumb·상품 상세 배너·마감** — 스모크 체크리스트 문서 포함 |

## 8. 검증 계획

**순수 헬퍼 단위 테스트** (`bulk-session-model.spec.ts` + 기존 spec 확장). §2.4 때문에 이것이 유일한 자동 검증이다.

| 함수 | 무엇을 못 박는가 |
|---|---|
| `getBulkSessionView(phase)` | phase 10개 전량 → 패널 매핑. 빠진 phase 가 있으면 빈 화면이 된다 |
| `bulkSessionRefetchInterval(progress)` | 워커 차례 2000 · 사람 차례 false · **`undefined` → 2000** |
| `computeItemProgress(counts, itemTotal)` | 분모가 `itemTotal` 이지 `totalRows` 가 아님 |
| `computeImageGate(requiredResolved, requiredTotal)` | 필터와 무관한 분모 |
| `matchFilesToImageRows(files, rows)` | 대소문자·앞뒤 공백·basename · **한 파일이 두 행(main/description)에 매칭** · 동명 파일 충돌 감지 |
| `chunkResolutions(entries)` | 50건 청킹 |
| `pairResolveResults(sent, results)` | **인덱스가 아니라 `(imageKey, usage)`** · 응답이 더 짧을 때 |
| `shouldContinuePurge({ purged, remaining })` | `remaining === 0` 또는 `purged === 0` 에서 멈춤 |
| `canApprove(phase, undecidedCount)` | 미결정 > 0 이면 false |
| `getVersionLifecycleActions` (기존 spec 확장) | `bulkSessionId` 가 있으면 발행·삭제 둘 다 false |

**core 3건**: 빈 양식 워크북 조립(단위) · `conflict` 필터 페이징(단위) · `approve` 가 리더를 쓰도록 바뀐 뒤에도 기존 통합 테스트가 그대로 초록인지.

**게이트**: admin-web `type-check` 차분 0 · 변경 파일 기준 jest 차분 · `.tsx` 는 `npx eslint` 직접. **전역 jest·tsc·`nest build core` 는 develop 에서도 red 라 "전체 초록"으로 판정하지 않는다**(상시 debt).

**스모크 체크리스트를 산출물로 낸다.** 백엔드 2~6단계가 남긴 미수행 15건과 화면분을 한 문서로 합치고, 맨 앞이 **MD 계정 `roles` 실측**이다. 실행은 사람이 한다.

## 9. 배포 선행조건

- **마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 변경 0건**
- 배포 순서: **core 먼저 → admin-web** (core 3건이 additive 라 admin-web 이 먼저 떠도 기능만 안 보이지 깨지진 않지만, 순서를 지키면 그 창도 없다)
- **MD 계정 `roles` 실측이 여전히 미해소 선행조건이다**(§10.7). 두 컨트롤러가 `RolesGuard('master','admin')` 이고 시드 롤은 `master`·`admin`·`membership`·`user`·`logistics_worker`·`logistics_manager` 여섯이다(`scripts/seeding/steps/user-service.seed-step.ts:94-108`). 실제 계정에 없으면 화면 전체가 403 이다 — 화면이 생기는 이 단계가 그것이 드러나는 첫 배포다
- 배포 후: 스모크 체크리스트를 한 번 완주한다. 백엔드 2~6단계는 **수동 스모크를 한 번도 돌리지 않은 채 배포됐다** — 이 단계가 그것을 처음으로 가능하게 한다
