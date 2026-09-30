# 관리자 수기 리뷰 작성 설계

작성일: 2026-09-30. 기준 HEAD `5c1554488`(develop).
상태: 설계 합의. 제품 코드·DB 는 아직 바꾸지 않았다.

## 1. 목표

리테일팀이 admin-web 에서 **다른 채널의 실제 고객 후기를 한 건씩 옮겨 적는다.** 스토어프론트에는 일반 리뷰와
똑같이 보인다(작성자명 마스킹·평점 집계 포함).

성공 기준:

- 리테일팀(`admin` 역할)이 admin-web 폼 하나로 상품·작성자명·원 작성일·별점·본문·사진을 넣고 저장할 수 있다.
- 저장한 리뷰가 스토어프론트 상품 리뷰 목록과 평점 요약에 반영된다.
- 그 리뷰는 **어떤 회원 계정으로도 수정·삭제할 수 없다.** 관리자 삭제·상태 변경만 된다.
- 통계에서 자체 작성분으로 세지 않고, 보상(작성 보상·주간 베스트)이 나가지 않는다.
- 누가 입력했는지 행에 남는다.

범위 밖: 엑셀 일괄 업로드, 작성 후 수정 API, 채널별 구분, 상품 존재 검증(§3.4), 다른 팀원이 돌리는 기존 이관 공정(§8).

## 2. 현재 상태 (2026-09-30 라이브 읽기전용 실측)

관리자가 리뷰를 쓰는 API 는 없다. 리뷰 생성 경로는 `POST /reviews` 하나이고, 회원 본인이 작성 권한
(`eligibilityId`)을 소비해야 한다(`reviews.service.ts` `create`).

라이브 `reviews` 는 세 갈래다.

| 갈래 | 건수 | 모양 |
|---|---|---|
| `source_system='smartstore'` | 47,299 | `user_id` NULL · 권한 없음 · `legacy_author_name`·`legacy_source_review_id`·`legacy_payload` 보유 |
| `source_system='almondyoung-legacy'` | 6,417 | 위와 같음 |
| 권한 `provider='admin'` | 7,488 | 한 계정 명의 · `source_system='almondyoung'` · `legacy_author_name` 보유 |

앞의 두 갈래가 스키마가 이관용으로 설계한 모양이고, 스토어프론트·통계·베스트 선정·탈퇴 처리가 모두 이
모양을 올바르게 다룬다. 세 번째 갈래는 다른 팀원이 저장소 밖 공정(SQL 로 권한 발급 → `POST /reviews` →
SQL 로 작성일·작성자명 소급)으로 넣고 있는 이관분이며, 이 설계는 **그 공정과 데이터를 건드리지 않는다.**

## 3. 결정

### 3.1 모양: 기존 이관분과 같은 모양으로 쓴다

| 컬럼 | 값 | 이유 |
|---|---|---|
| `user_id` | NULL | 회원용 `PATCH`/`DELETE /reviews/:id` 는 `user_id` 일치 **와** `source_system='almondyoung'` 을 함께 요구한다 — 둘 다에서 막힌다. 「내 리뷰」에도 안 뜬다 |
| `review_permission_id` | NULL | 권한을 발급하지 않는다. 쓰고 버릴 권한 행을 만들면 권한 모델이 왜곡된다 |
| `source_system` | `'admin-manual'` | «어디서 들어왔나» 축. `isOwnSource` 가 거짓 → 통계는 이관분으로, 베스트 후보에서 제외 |
| `legacy_author_name` | 입력한 작성자명 | 스토어프론트 `getAuthorName` 이 이 값을 먼저 보고, `*` 가 없으면 마스킹한다 |
| `created_at` | 입력한 원 작성일 | 목록 정렬·표시가 원 작성일 기준이 된다 |
| `legacy_imported_at` | 입력 시각(now) | 기존 이관분과 같은 의미 |
| `created_by_admin_user_id` | 호출한 관리자 `userId` | **신규 컬럼.** 입력자 감사. §4 |
| `legacy_source_review_id`·`legacy_source_order_id`·`legacy_member_id`·`legacy_payload` | NULL | 한 건씩 입력이라 원본 키가 없다. 중복은 사람이 목록에서 보고 판단한다 |

기각한 대안:

- **팀원 모양 재현**(admin 권한 발급+소비, 입력 직원 명의): 화면은 팀원분과 일관되지만 리테일 직원 각자의
  계정이 리뷰 소유자가 되어 스토어프론트에서 수정·삭제할 수 있고, `source_system='almondyoung'` 이라
  자체작성 통계를 오염시킨다.
- **SQL 공정을 스크립트로 저장소에 올리기**: 검증·이벤트 발행이 없다.

### 3.2 출처값은 하나

채널 구분이 필요 없다(사용자 결정). `source-system.ts` 에 `ADMIN_MANUAL_SOURCE_SYSTEM = 'admin-manual'`
을 추가한다. 출처 리터럴은 이 파일에만 산다(`source-system.spec.ts` 가 사본을 막는다).

### 3.3 권한: 기존 스코프 그대로

리테일팀은 이미 `admin` 역할이다. 새 스코프 없이 `admin:ugc:modify` 를 쓴다(`ugc-scopes.ts` 매핑 변경 없음).
그 스코프가 리뷰 삭제·Q&A 답변·샵 매매 검토까지 여는 것은 사용자가 수용했다.

### 3.4 상품 존재 검증은 하지 않는다

ugc-service 에는 core 를 부르는 클라이언트가 없고, 이 기능 하나로 서비스 간 동기 의존을 만들지 않는다.
`productId` 는 admin-web 상품 선택기에서만 온다. 서버는 UUID 형식만 검증한다.

## 4. 스키마

`apps/ugc-service/src/db/schema.ts` `reviews` 에 추가:

```ts
/** 관리자 수기 작성분의 입력자. 회원 작성·이관분은 NULL. */
createdByAdminUserId: uuid('created_by_admin_user_id'),
```

nullable 추가 = expand 단계. `npm run db:generate:ugc-service -- --name add-review-created-by-admin`.
FK·인덱스 없음(관리자는 user-service 소속, 이 컬럼으로 조회하지 않는다).

## 5. 백엔드 API

### 5.1 엔드포인트

`POST /reviews/admin/reviews` — `ReviewsController`, `@RequireScopes('admin:ugc:modify')`,
`@User('userId') adminUserId`. 응답은 `AdminReviewResponseDto`(201).

### 5.2 요청 DTO `AdminCreateReviewDto`

| 필드 | 검증 |
|---|---|
| `productId` | `@IsUUID()` |
| `authorName` | `@IsString()`, trim 후 1~100자(`legacy_author_name` 길이) |
| `writtenAt` | `@IsISO8601()`(오프셋 포함 시각). 현재 시각보다 미래면 400 |
| `rating` | `@IsInt() @Min(1) @Max(5)` |
| `content` | `@IsString() @MinLength(1)` |
| `mediaFileIds?` | 기존 `CreateReviewDto` 와 같은 규칙(최대 `MAX_REVIEW_MEDIA_COUNT`=5, UUID, 중복 금지) |

미래 시각 판정은 DTO 데코레이터가 아니라 서비스에서 한다(현재 시각 주입으로 테스트 가능하게).

### 5.3 동작 `ReviewsService.createByAdmin(adminUserId, dto, tx?)`

기존 `create` 옆에 둔다 — `normalizeMediaFileIds`·`insertReviewMedia`·`publishStatsAfterCommit` 을 그대로 쓴다.

1. 한 트랜잭션에서 `reviews` insert(§3.1 값) → `insertReviewMedia`.
2. 보상 판정·보상 원장 기록을 **하지 않는다.** 회원이 없으니 줄 대상도 없다. 「0원 지급」과 구별할 건너뜀
   기록(`NON_ORDER_PROVIDER`)은 회원 작성 경로의 개념이라 여기엔 남기지 않는다.
3. 외부 트랜잭션이 없을 때 커밋 후 `publishStatsAfterCommit(productId)` — 평점 요약 이벤트.
4. 반환값은 `adminComment: null`, 반응 수 0 으로 채운 엔티티.

### 5.4 관리자 조회 확장

- `AdminReviewResponseDto` 에 `sourceSystem: string`, `createdByAdminUserId: string | null` 추가.
  공개 `ReviewResponseDto` 에는 넣지 않는다(입력자 id 를 스토어프론트로 내보내지 않는다).
- `AdminReviewListQueryDto` 에 `sourceSystem?: string`(정확 일치, 최대 30자) 필터 추가 — 리테일팀이
  자기 입력분만 모아 본다.

### 5.5 시간대

`created_at` 은 `timestamp`(without time zone) 이고 postgres.js 경로에서 −9h 어긋남 사례가 있었다.
admin-web 은 날짜 선택값을 `YYYY-MM-DDT00:00:00+09:00` 로 보내고 서버는 그 순간값을 그대로 저장한다.
통합 스펙에서 저장 → 조회 왕복 시각이 같은지 확인한다(§7).

## 6. admin-web

- **진입**: 리뷰 관리(`features/cs/review/template`) 헤더에 [리뷰 작성] 버튼 → `/cs/reviews/new`.
  페이지 가드는 목록과 같은 `RouteGuard requireRole={['admin', 'master']}`.
- **폼**:
  - 상품 — 타임세일·쿠폰 화면의 상품 선택기 패턴 재사용.
  - 작성자명 — 안내문: 「원문 이름 그대로 입력하세요. 쇼핑몰에는 가려져 표시됩니다.」
  - 작성일 — 날짜 선택, 기본 오늘, 미래 선택 불가.
  - 별점(1~5)·본문.
  - 사진 — 최대 5장, `review-media` 컨텍스트, 업로드 전 클라이언트 압축(`lib/utils/image-compress.ts`).
    admin-web 업로드 프록시의 약 4.7MB 벽 때문이다. 동영상은 받지 않는다.
  - 저장 성공 → 해당 리뷰 상세(`/cs/reviews/[id]`)로 이동.
- **표시**:
  - 목록 「작성 권한」 칸: `sourceSystem === 'admin-manual'` 이면 「관리자 수기 작성」, 아니면 기존 provider 라벨.
    판정은 `.ts` 순수 함수로 둔다.
  - 상세: 같은 라벨 + 입력자(`createdByAdminUserId` → 사용자 이름, 없으면 id).
  - 목록 탭에 「관리자 수기 작성」 추가 → `sourceSystem=admin-manual` 쿼리.

## 7. 검증

기준선: `npm run type-check` 0, 루트 `npx jest` 실패 0.

- **ugc 유닛** `createByAdmin`: insert 값(`userId`·`reviewPermissionId` NULL, `sourceSystem`,
  `createdByAdminUserId`, `createdAt`=`writtenAt`, `legacyAuthorName`), 보상 서비스 미호출
  (`reward-provider-boundary.spec` 방식), 미디어 순서, 미래 `writtenAt` 거부.
- **DTO**: 별점 범위·작성자명 길이·미디어 개수/중복 거부.
- **경계 불변식**: `isOwnSource`/`isLegacySource` 가 `'admin-manual'` 을 이관 쪽으로 가르는지.
- **통합**(`describeIfDb` 가드, `--runInBand`): 실 DB 에 작성 → 공개 목록·평점 요약에 포함, 회원
  `PATCH`/`DELETE /reviews/:id` 로 수정·삭제 불가, `created_at` 왕복 일치, 관리자 목록 `sourceSystem` 필터.
- **admin-web**: CI 가 admin-web 을 돌리지 않으므로 `cd apps/admin-web && npx tsc --noEmit` 를 직접 돌린다.
  라벨 판정·작성일 직렬화는 순수 함수 테스트(`npm run test:admin-web`).
- **수동 스모크**(로컬 E2E): admin 계정으로 사진 포함 1건 작성 → 「관리자 수기 작성」 탭 → 스토어프론트 상품
  리뷰에 마스킹된 이름·원 작성일로 표시 → 평점 요약 반영.

## 8. 배포

1. ugc 마이그레이션 1건(expand) → **`db:migrate` 먼저, 그 다음 `sst deploy`**. 반대로 하면 새 코드가
   없는 컬럼에 insert 한다.
2. admin-web 은 같은 스택 배포로 함께 나간다.
3. 배포 후 라이브에서 1건 작성·확인 후 필요 시 관리자 삭제.

## 9. 참고: 기존 admin 권한 이관분에서 본 것 (범위 밖, 팀원 전달용)

7,488건(배치 495개, 09-22~09-29 적재, 계속 증가 중)에 대해 코드로 확인한 성질이다. 고칠지는 그 공정 담당자가 정한다.

- 전부 한 계정(`cdca6b63…`) 명의이고 `source_system='almondyoung'` 이라, 그 계정으로 스토어프론트에
  로그인하면 「내 리뷰」에 전부 뜨고 본인 리뷰로 수정·삭제할 수 있다(회원 수정·삭제의 두 조건을 모두 만족).
  ugc 의 탈퇴 처리는 샵 매매에만 닿으므로 계정 탈퇴가 리뷰를 지우지는 않는다.
- `source_system='almondyoung'` 이라 관리자 통계가 자체 작성분으로 센다.
- 원본 키가 `legacy_source_review_id` 가 아니라 `granted_reason` 자유문 안의 `set=<hash>` 라 DB 수준 중복 방지가 없다.
- 보상은 새지 않는다 — 7,488건 모두 `NON_ORDER_PROVIDER` 로 건너뜀 기록이 있고, 베스트 후보 선정도 admin 권한을 제외한다.
