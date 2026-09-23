# 샵 매매 게시판을 ugc-service 로 옮기고 회원 작성을 연다

작성일: 2026-09-23 (KST). 기준: `develop` 의 `e1ade9f10` (#955).
브랜치: `docs/shop-listings-to-ugc-spec`.
상태: 설계 확정. 구현·이관·배포 미착수.

## 1. 문제와 목표

샵 매매 게시판(스토어프론트 `/shop-trade`)은 2026-08-12 PR #628 로 core 에 들어온 라이브 기능이다.
작성은 관리자 전용(`RolesGuard('master','admin')`)이고 읽기는 공개다.

목표는 셋이다.

1. 도메인을 core(`apps/core/src/modules/catalog/core/shop-listings/`)에서 ugc-service 로 옮긴다.
2. 관리자뿐 아니라 **로그인 회원도** 매물 글을 쓸 수 있게 한다. 회원 글은 검토를 거쳐 공개한다.
3. 판매자 연락처를 구조화한다. 2026-09-07 라이브 실측에서 연락처 필드가 없어 대부분의 글이
   전화번호를 「010-오팔칠칠-…」처럼 한글로 치환해 본문에 적고 있었다(클릭·복사 불가). 연락 수단이
   아예 없는 글도 있었다.

URL(`/shop-trade`, `/shop-trade/{slug}`)과 기존 글의 slug·id·조회수는 유지한다.

## 2. 제약

- 레이어는 CLAUDE.md 규약(Controller → Service → Reader/Manager → Repository)을 따른다.
  코드 견본은 ugc 의 리뷰가 아니라 **core 의 shop-listings** 다 — ugc 리뷰는 두꺼운 Service 가
  drizzle 을 직접 쓰고 Nest 예외를 던진다.
- 트랜잭션은 `DbService.run(fn, tx)` 하나로 전파한다(ADR-0025). ugc 리뷰의 `inTx` 헬퍼를 따라 하지 않는다.
- 스키마 변경은 `npm run db:generate:ugc-service -- --name <kebab>` 로만 만든다. 한 커밋에 schema + SQL + meta.
- core·ugc·file-service·admin-web·스토어프론트는 **한 SST 스택**이라 `sst deploy` 한 번에 같이 올라가며
  배포 순서를 지정할 수 없다. 순서가 필요한 변경은 PR 과 배포를 나눠서 만든다.
- 스토어프론트의 공개 페이지는 뷰어 구분 없이 한 벌로 캐시된다(ADR-0038, 60초 ISR + CDN).
  로그인 여부에 따라 달라지는 값을 공개 응답에 섞지 않는다.

## 3. 결정과 기각한 대안

| 주제 | 결정 | 기각한 대안 |
|---|---|---|
| 회원 글 공개 시점 | 판정기 → 확신도로 승인·거절·관리자 대기. 첫 릴리스는 판정기 없이 **전부 관리자 대기** | 즉시 공개 + 사후 숨김 (첫 릴리스에 rate limit·신고가 필요해진다) |
| 판정기 | Jev(TypeSafe AI 의 System One 모델). 키가 아직 없어 **포트만 두고** 별도 PR 로 연결 | LLM 판정 (느리고 비싸다) |
| 본문 형식 | 관리자·회원 모두 **마크다운** | 전원 plain text (서식 손실) / 제한 HTML (서버 sanitize 신규 + 스토어프론트 리치 에디터 신규) / 작성자별 형식 분리 (렌더러 두 벌) |
| 이미지 저장 | 정규화 테이블 `shop_listing_images` (ugc 의 `review_media` 와 같은 모양) | jsonb 배열 (같은 서비스 안에 방식이 두 벌이 되고 DB 무결성이 없다) |
| 연락처 | 구조화 필드 + **로그인 회원에게만** 별도 라우트로 공개 | 항상 공개 (크롤러 수집) / 범위 밖 |
| 작성 자격 | 로그인 회원 + 동시 게시 한도 | 제한 없음 / 사업자 인증·멤버십 등 자격 조건 |
| 승인 후 회원 수정 | 수정 = 재검토(`pending` 으로 내려가 비공개) | 공개 유지 + 사후 재검토 (바꿔치기 창) / 수정 불가 |
| 작성자 표시 | 공개 페이지에 표시하지 않는다 | 배지 / 마스킹 닉네임 |
| 관리자 권한 | 기존 scope `admin:ugc:read`·`admin:ugc:modify` 재사용 | 전용 scope 신설 (매핑 시드 전까지 master 만 관리 가능) |
| 이관 | 두 번 배포 + 멱등 복사 스크립트 (§9) | 한 번 배포 (§9.1 의 사이트맵 함정) / core 를 ugc 프록시로 유지 (서비스 간 결합 신설) |
| 탈퇴 회원 글 | 컨슈머가 연락처 NULL + soft delete. **물리 삭제 크론은 두지 않는다** | 30일 뒤 물리 삭제 크론 |

## 4. 데이터 모델 (ugc DB, `public` 스키마)

### 4.1 `shop_listings`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | 앱에서 uuidv7. 이관 행은 core 의 id 를 보존한다 |
| `slug` | varchar(120) NOT NULL | partial unique `WHERE deleted_at IS NULL`. 이관 행은 보존 |
| `title` | varchar(255) NOT NULL | |
| `content` | text NOT NULL | 마크다운, 최대 10,000자. 공백만 있으면 400 |
| `region`, `business_type`, `deal_type` | varchar(20) | 값 목록은 core 의 `shop-listing.constants.ts` 를 그대로 옮긴다. 컬럼은 nullable(이관 행), 새 글은 DTO 가 필수로 요구 |
| `area_pyeong` | integer | |
| `deposit`, `monthly_rent`, `key_money` | bigint | null 이면 화면에 「협의」 |
| `contact_phone` | varchar(20) | 입력의 하이픈·공백을 제거하고 숫자만 저장(`^0\d{8,10}$`). 회원 글은 필수, 관리자 글은 선택. 이관 행은 NULL |
| `kakao_open_chat_url` | varchar(255) | 선택. `https://open.kakao.com/` 로 시작해야 한다 |
| `author_type` | enum `admin` \| `member` NOT NULL | 서버가 라우트로 정한다. 클라이언트 입력 아님 |
| `author_user_id` | uuid | 이관 행은 core 의 `created_by`. 공개 응답에 넣지 않는다 |
| `status` | enum (§5) NOT NULL | core 의 `is_active` 를 대체 |
| `reject_reason` | text | 가장 최근 거절 사유 |
| `submitted_at` | timestamp | 가장 최근 `pending` 진입 시각. 검토 대기열 정렬 기준 |
| `view_count` | integer NOT NULL default 0 | 이관 행은 보존 |
| `updated_by`, `deleted_by` | uuid | |
| `created_at`, `updated_at`, `deleted_at` | timestamp | 이관 행은 `created_at` 보존 |

인덱스: `status`, `author_user_id`, `created_at`, `deleted_at`, `region`, `business_type`, `deal_type`.

core 의 `thumbnail_file_id` 는 옮기지 않는다. **썸네일은 `order = 0` 인 이미지다.**

### 4.2 `shop_listing_images`

`review_media` 와 같은 모양이다.

- `listing_id` uuid NOT NULL → `shop_listings.id` FK `ON DELETE CASCADE`
- `file_id` uuid NOT NULL (file-service 의 fileId)
- `order` integer NOT NULL
- PK `(listing_id, file_id)`, unique `(listing_id, order)`, index `file_id`
- 글당 1~15장. 수정은 트랜잭션 안에서 전부 지우고 다시 넣는다.

### 4.3 `shop_listing_moderations` (추가만 하는 판정 이력)

- `id` uuid PK, `listing_id` FK `ON DELETE CASCADE`
- `decided_by` enum `admin` \| `classifier`
- `decision` enum `approved` \| `rejected` \| `pending` \| `hidden` \| `unhidden`
- `label` varchar, `confidence` real — 판정기 결과일 때만
- `reason` text, `actor_user_id` uuid — 관리자 판정일 때
- `title_snapshot`, `content_snapshot` — 판정 당시 제목·본문
- `created_at`

첫 릴리스에서는 관리자 판정만 쌓인다. Jev 연결 시 이 이력이 임계값을 재는 정답셋이 된다(§6.3).

### 4.4 `shop_listing_views`

core 구조를 그대로 옮긴다: `listing_id`(FK `ON DELETE CASCADE`), `visitor_hash` varchar(64),
`viewed_on` date, unique `(listing_id, visitor_hash, viewed_on)`.

## 5. 상태 전이

`status`: `pending` \| `published` \| `rejected` \| `hidden` \| `closed`.
공개 API 가 노출하는 것은 `published` 와 `closed`(「거래완료」 배지)뿐이다.

| 현재 → 다음 | 주체 | 조건·부수효과 |
|---|---|---|
| (신규) → `pending` | 회원 작성 | 동시 게시 한도 검사. 판정기 결과에 따라 `published`/`rejected` 로 바로 갈 수 있다(§6) |
| (신규) → `published` | 관리자 작성 | `author_type = admin` |
| `pending`·`published`·`closed`·`rejected` → `pending` | 회원 수정 | 한도 검사(`closed`·`rejected` 에서 올 때). slug 불변 |
| `hidden` → (거부) | 회원 수정 | 409. 수정으로 관리자 숨김을 우회하지 못하게 한다. 삭제는 허용 |
| `pending` → `published` | 관리자 승인 / 판정기 | moderation 기록 |
| `pending` → `rejected` | 관리자 거절(사유 필수) / 판정기 | `reject_reason` 갱신, moderation 기록 |
| `published`·`closed` → `hidden` | 관리자 숨김 | moderation 기록 |
| `hidden` → `published` | 관리자 숨김 해제 | moderation 기록 |
| `published` → `closed` | 작성 회원 / 관리자 | 검토 없음 |
| `closed` → `published` | 작성 회원 / 관리자 | 검토 없음, 한도 검사 |
| 어느 상태든 → soft delete | 작성 회원 / 관리자 | `deleted_at` 기록. 회원 삭제는 연락처 두 필드를 즉시 NULL 로 |

관리자 수정은 상태를 바꾸지 않는다(재검토 없음). 관리자는 회원 글도 수정할 수 있다.

**동시 게시 한도:** 회원당 `pending + published` 가 3건. 상수로 둔다.
동시 요청이 한도를 넘지 않도록 트랜잭션 안에서 `pg_advisory_xact_lock(hashtext(author_user_id))` 를 잡고 센다.

## 6. 검토 파이프라인

### 6.1 흐름

```
회원 작성·수정 → classifier.classify(입력) → decide(결과) → status 저장 + moderation 기록
                  (DB 트랜잭션 밖, 타임아웃 1초)   (순수 함수)
```

### 6.2 구성 요소

- **`ShopListingClassifier` 포트.** 입력: 제목, 본문, 지역, 업종, 거래유형, 금액.
  출력: `{ label: 'shop_listing' | 'not_shop_listing', confidence: number } | null`.
  공급사 SDK 타입을 포트에 노출하지 않는다.
- **v1 구현 `NullClassifier`.** 항상 `null`. 따라서 v1 의 회원 글은 전부 `pending`. moderation 행도 쓰지 않는다.
- **`decide(result, policy)` 순수 함수.**
  - `shop_listing` 이고 `confidence ≥ T_approve` → `published`
  - `not_shop_listing` 이고 `confidence ≥ T_reject` → `rejected`
  - 그 밖, `null`, 자동 판정 플래그 off → `pending`
- **실패 = `pending`.** 타임아웃·5xx·키 누락 모두. 판정기 장애가 글쓰기를 막지 않는다.
- **플래그 `SHOP_LISTING_AUTO_DECISION`** (기본 off). off 면 판정기 결과를 moderation 에 기록만 하고 상태는 `pending`.

### 6.3 Jev 연결 (별도 PR, 키 발급 후)

1. `JevClassifier` 어댑터 추가. 한국어 판정 품질은 공개 자료로 확인되지 않았으므로 여기서 실측한다.
2. 플래그 off 로 배포 → 섀도 모드. 관리자 판정과 Jev 판정을 moderation 이력으로 대조한다.
3. `T_approve`·`T_reject` 를 정하고 플래그를 켠다.

**알고 두는 한계:** Jev 는 이미지를 입력으로 받지 않는다(2026-09 기준 「not yet」).
자동 승인이 켜져도 사진은 관리자 사후 숨김이 유일한 방어선이다. 플래그를 켤지 판단할 때 이 한계를 포함한다.

## 7. API (ugc-service)

전역 prefix 없음. 전역 가드는 `JwtAuthGuard` + `ScopeGuard`.
컨트롤러 셋으로 나누고, `author_type` 은 어느 컨트롤러로 들어왔는지로 정한다.

### 7.1 공개 (`@Public`)

| 라우트 | 응답 |
|---|---|
| `GET /shop-listings/public` | `published`·`closed` 전체, `created_at DESC`. 이미지 포함, **연락처 없음** |
| `GET /shop-listings/public/:slug` | 단건, 연락처 없음. 그 밖의 상태는 404 |
| `POST /shop-listings/public/:slug/view` | 204. core 의 조회수 로직 그대로(IP+id sha256, KST 일 단위 dedup) |

페이지네이션은 core 와 같이 두지 않는다(스토어프론트가 클라이언트 측에서 필터·페이지를 처리한다).

### 7.2 연락처 (로그인 필요)

`GET /shop-listings/public/:slug/contact` → `{ contactPhone, kakaoOpenChatUrl }`. `published`·`closed` 만.
공개 목록·상세에 섞지 않는 이유는 §2 의 캐시 제약이다. 크롤러는 구조적으로 연락처를 볼 수 없다.

### 7.3 회원 (로그인 필요)

| 라우트 | 동작 |
|---|---|
| `POST /shop-listings` | 작성(§5). slug 는 제목에서 자동 생성(core 의 slugify 이식) |
| `GET /shop-listings/mine` | 내 글 전체(상태·거절 사유 포함) |
| `GET /shop-listings/:id` | 본인 글 단건(수정 폼용) |
| `PUT /shop-listings/:id` | 수정(§5) |
| `POST /shop-listings/:id/close` · `/reopen` | 거래완료 ⇄ 게시 |
| `DELETE /shop-listings/:id` | soft delete + 연락처 NULL |

소유권은 SELECT·UPDATE 의 `WHERE` 에 `author_user_id = :me AND deleted_at IS NULL` 로 넣는다.
남의 글은 404(존재 은닉). ugc 리뷰의 update 에 `deleted_at` 조건이 빠진 결함을 따라 하지 않는다.
이 라우트들은 `scripts/security/idor-reviewed.spec.ts` 에 등록한다.

### 7.4 관리자 (`/admin/shop-listings`)

조회 `@RequireScopes('admin:ugc:read')`, 쓰기 `@RequireScopes('admin:ugc:modify')`.

- `GET /` — 필터 `status`, `authorType`, `q`(제목 ILIKE). `status=pending` 은 `submitted_at ASC`, 그 밖은 `created_at DESC`
- `GET /:id` — 판정 이력 포함
- `POST /` — 관리자 작성. slug 지정 가능
- `PUT /:id` — 관리자 수정
- `POST /:id/approve`, `POST /:id/reject {reason}`, `POST /:id/hide`, `POST /:id/unhide`
- `DELETE /:id`

**권한 범위가 바뀐다.** 지금은 `master`·`admin` 두 역할만 관리한다. ugc 는 역할→scope 매핑을 DB 에서 읽으므로
전환 후에는 「`admin:ugc:modify` 를 가진 역할 전부」가 매물을 관리한다. 배포 전에 실측한다(§9.5).

## 8. 프론트

### 8.1 스토어프론트 (`web/almondyoung-storefront`)

- `lib/api/pim/shop-listings.ts` → `lib/api/ugc/shop-listings.ts`. 서비스 키 `"pim"` → `"ugc"`. 캐시 태그와 `revalidate: 60` 유지.
- 본문 렌더: `sanitizeNoticeHtml` 대신 `react-markdown` + `remark-gfm`(둘 다 이미 의존성에 있다).
  - `rehype-raw` 를 붙이지 않는다(원시 HTML 은 이스케이프).
  - `img` 요소는 렌더하지 않는다. 사진은 갤러리로만 받는다.
  - 링크는 `rel="nofollow ugc noopener"`, 허용 스킴은 `http`·`https`·`tel`.
  - 이 옵션은 `.ts` 모듈 하나로 빼서 스토어프론트와 admin-web 미리보기가 같은 규칙을 쓴다.
- 상세 페이지에 「연락처 보기」 클라이언트 컴포넌트. 비로그인이면 로그인 진입, 로그인이면 §7.2 호출 후 `tel:`·오픈채팅 링크.
- 목록 카드·상세에 `closed` → 「거래완료」 배지.
- 회원 작성 화면은 **`/mypage/shop-listings/*`** 에 둔다.
  `middleware.ts` 의 `CACHEABLE_PATH_PREFIXES` 가 `/shop-trade` 를 접두사로 매칭하므로 `/shop-trade/new` 에 두면
  사람마다 다른 화면이 CDN 에 캐시된다. `/mypage` 는 이미 로그인 보호 경로이고 캐시 대상이 아니다.
  - `/mypage/shop-listings` — 내 매물(상태·거절 사유·거래완료 전환·삭제)
  - `/mypage/shop-listings/new`, `/mypage/shop-listings/[id]/edit` — 마크다운 textarea + 미리보기, 이미지 1~15장(첫 장이 썸네일), 연락처
  - `/shop-trade` 목록에 「매물 등록」 진입 버튼
- `sitemap.ts` 는 API 호출부만 바꾼다. URL 불변.

### 8.2 file-service

전용 file context `shop-listing-image`(public, `image/*`, 10MB)를 `apps/file-service/src/database/default-file-contexts.ts` 에 추가한다.
지금은 공지용 `notice-content-image` 를 같이 쓰고 있다.
**file context 는 마이그레이션이 아니라 시드다** — `db:seed:ref` 를 돌리지 않으면 이 컨텍스트 업로드가 전부 404 다.

### 8.3 admin-web

- 클라이언트: `/proxy/api/shop-listings` → `/proxy/ugc/admin/shop-listings`.
- 폼: tiptap 리치 에디터 → 마크다운 textarea + 미리보기(§8.1 의 렌더 규칙). 연락처 필드 추가. 이미지 컨텍스트 `shop-listing-image`.
- 목록: `status`·`authorType` 필터, 기본 탭 「검토 대기」.
- 상세: 승인·거절(사유 입력)·숨김·숨김 해제, 판정 이력.
- `types/dto/products.ts` 에 복제된 enum·DTO 를 새 형태로 맞춘다.

## 9. 이관·배포

### 9.1 왜 두 번 배포인가

스토어프론트 `sitemap.ts` 는 `force-static`(하루 1회 재생성)이라 **빌드 시점에** 매물 API 를 부른다.
ugc 엔드포인트 추가와 스토어프론트 전환을 한 배포에 묶으면, 스토어프론트 빌드가 아직 옛 코드로 도는 ugc 를
불러 사이트맵에서 매물 URL 이 하루 동안 빠질 수 있다. 롤링 중 새 스토어프론트가 옛 ugc 태스크를 만나 404 를 받는 창도 생긴다.

### 9.2 PR 1 — expand (ugc + file-service, 사용자 영향 없음)

- ugc 마이그레이션 1건: §4 의 테이블 넷. 전부 additive.
- ugc 의 공개·회원·관리자 컨트롤러, `UserPermanentDeleted` 컨슈머, `NullClassifier`.
- file-service `shop-listing-image` 시드.
- 복사 스크립트 `scripts/ops/shop-listings-migrate/` (§9.3).
- 배포: `db:migrate`(ugc) → `db:seed:ref`(file-service) → `sst deploy`. expand 이므로 migrate 가 먼저다.
- 배포 후 프론트는 아직 core 를 본다. ugc 새 API 를 스모크한다.

### 9.3 복사 스크립트

- 입력: core DB 와 ugc DB 연결 문자열(`sst shell` 안에서 실행). 두 DB 는 같은 RDS 인스턴스의 서로 다른 데이터베이스다.
- 대상: core `shop_listings` 중 `deleted_at IS NULL` 인 행과 그 `shop_listing_views`. soft delete 된 행은 복사하지 않는다.
- 변환:
  - HTML → 마크다운(`<p>` → 문단, `<br>` → 줄바꿈, 엔티티 디코드). 그 밖의 태그를 만나면 **실패하고 행 id 를 출력**한다(조용한 손실 금지).
  - `is_active` true → `published`, false → `hidden`.
  - `created_by` → `author_user_id`, `author_type = admin`.
  - `thumbnail_file_id` + `images` → `shop_listing_images`. 썸네일이 `images` 에 없으면 `order = 0` 으로 앞에 끼운다. 중복 fileId 는 한 번만.
  - 연락처 필드는 NULL.
- 멱등: `shop_listings` 는 id 기준 upsert, `view_count` 는 `GREATEST(기존, 원본)`. 이미지는 행마다 지우고 다시 넣는다.
  views 는 unique 키 기준 `ON CONFLICT DO NOTHING`.
- `--dry-run`: 건수, 상태별 분포, 변환 샘플 몇 건의 전후를 출력하고 쓰지 않는다.

### 9.4 복사와 PR 2 — 전환 (스토어프론트 + admin-web)

1. 관리자에게 **매물 쓰기 동결**을 공지한다(PR 2 배포 완료까지).
2. 복사 `--dry-run` → 실행 → 건수 대조, slug 몇 건의 렌더 확인.
3. PR 2(§8.1·§8.3 전부) 머지.
4. `sst deploy` **직전에 복사를 한 번 더** 돌려 그사이 쌓인 조회수를 합친다.
5. `sst deploy`. 동결 해제.

롤백: core 의 옛 API·테이블이 그대로 있으므로 PR 2 revert 로 돌아간다. 전환 뒤 새로 쓴 글은 core 에 없다.

### 9.5 배포 전 실측 (PR 1 배포 전)

- 라이브 auth DB 에서 `admin:ugc:read`·`admin:ugc:modify` 를 가진 역할 목록 — §7.4 의 권한 범위 변화가 의도대로인지.
- core `shop_listings` 의 살아 있는 행 수, `thumbnail_file_id` 가 `images` 에 없는 행 수.
- core 본문에 `<p>`·`<br>` 이외의 태그가 쓰인 행 — 있으면 변환 규칙을 먼저 늘린다.

### 9.6 PR 3 — core 코드 제거

core `shop-listings` 모듈과 `catalog.module.ts` 의 연결을 지운다. PR 2 배포 뒤 **최소 한 번의 배포가 지난 다음** 머지한다.

### 9.7 PR 4 — contract

core `shop_listings`·`shop_listing_views` DROP. 순서는 `sst deploy` → `db:migrate`(contract).

## 10. 탈퇴 회원과 개인정보

- ugc 에 `@On(USER_STREAM, 'UserPermanentDeleted')` 컨슈머를 둔다(선례 `apps/ai/src/assistant/consumers/user-permanent-deleted.consumer.ts`).
  탈퇴 회원의 매물은 연락처 두 필드를 NULL 로, `deleted_at` 을 기록한다. 컨슈머는 멱등이다.
- 컨슈머는 모듈의 `controllers: []` 에 등록해야 실제로 구독한다. 빠져도 에러가 나지 않으므로 등록 여부를 스펙으로 지킨다.
- 물리 삭제 크론은 두지 않는다.

**알고 두는 잔여:**
- soft delete 된 회원 글의 본문과 판정 이력 스냅샷은 DB 에 남는다. 본문에 전화번호를 적은 경우 그 번호도 남는다.
- file-service 의 이미지 파일은 남는다(리뷰와 같은 기존 공백).
- ugc 의 리뷰·Q&A 도 탈퇴를 처리하지 않는다. 이번 범위 밖이며 별도 이슈로 발행한다.

## 11. 테스트

### 11.1 ugc 유닛 (루트 `npx jest`)

- `decide()` — 표 기반: 임계값 경계, `null`, 라벨별, 플래그 off.
- 상태 전이 — §5 표의 허용·거부 전부.
- slugify·조회수 해시 — core `shop-listing.manager.spec.ts` 이식.
- HTML → 마크다운 변환 — `<p>`, `<br>`, 엔티티, 빈 문단, 허용 밖 태그는 실패.
- 컨슈머 등록 가드.

### 11.2 ugc 통합 (`describeIfDb`, `--runInBand`)

- 동시 게시 한도: 병렬 4건 생성 → 3건 성공.
- 소유권: 남의 글 조회·수정·거래완료·삭제 → 전부 404.
- 회원 수정 → `pending`, slug 불변.
- `UserPermanentDeleted` → 연락처 NULL, 공개 목록에서 빠짐.
- 복사 스크립트 두 번 실행 → 결과 동일.

### 11.3 보안 레지스트리

- 회원 `:id` 라우트를 `idor-reviewed.spec.ts` 에 등록.
- `route-authz-audit` 통과 — `@Public` 쓰기 라우트는 조회수 비콘 하나.

### 11.4 프론트 (CI 게이트 없음)

- 마크다운 렌더 옵션 모듈의 스펙: `rehype-raw` 부재, `img` 비렌더, 링크 `rel`.
- admin-web: `cd apps/admin-web && npx tsc --noEmit` 수동.
- 수동 스모크:
  1. 회원 작성 → 내 매물에 「검토 대기」 → 공개 목록에 없음
  2. 관리자 승인 → 60초 안에 공개 목록·상세 노출
  3. 관리자 거절(사유) → 내 매물에 사유 → 수정 재제출 → 「검토 대기」
  4. 승인된 글 회원 수정 → 공개 목록에서 빠짐, slug 불변
  5. 거래완료 → 배지, 재개 → 배지 제거
  6. 동시 게시 한도 4건째 거부
  7. 연락처 보기: 비로그인 → 로그인 진입 / 로그인 → 번호·오픈채팅 링크
  8. 관리자 작성 → 바로 공개, 관리자 숨김 → 회원 수정 거부·삭제 가능
  9. 본문에 `<script>`·`![](…)`·`javascript:` 링크 → 원문 텍스트로 보이거나 렌더되지 않음
  10. 이관 글: 기존 slug URL 접속, 조회수 유지, 사이트맵에 포함

## 12. 범위 밖

- 판정기 실연결(Jev) — §6.3, 별도 PR.
- 승인·거절 알림 — 회원은 「내 매물」 에서 확인한다.
- 시간당 rate limit, 신고, 이미지 판정.
- 회원 닉네임·작성자 표시.
- 물리 삭제 크론, file-service 고아 파일 정리.
- 리뷰·Q&A 의 탈퇴 처리(별도 이슈).
