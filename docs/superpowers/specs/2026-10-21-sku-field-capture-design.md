# SKU 실측 작업 (포장 크기·실물 사진·제조사 바코드) — 설계

2026-10-21 · 브레인스토밍 결과. 구현 계획은 이 문서에서 `superpowers:writing-plans` 로 만든다.

## 1. 의도

물류창고에 새 인력이 생겼다. 이들에게 **재고가 있는 SKU 를 하나씩 손에 들고, 폰 하나로** 세 가지를 등록시킨다.

1. **포장째 가로·세로·높이 실측값 (mm).**
2. **실물 사진 3장 이상.** 상품의 모든 면이 최소 한 장에는 나와야 한다. 이 사진은 **대표 썸네일이 아니라
   «실제로 찍은 상품 기록»** 이다. 나중에 3D 모델링 등에 쓴다.
3. **제조사 바코드.** 포장에 제조사 바코드가 인쇄돼 있으면 찍어서 그 SKU 에 붙인다.

작업자는 **미용 상품을 모른다.** 그래서 SKU 는 이름 검색이 아니라 **선반 위치로 찾는다** (§4).

### 왜 바코드까지 묻는가

라이브 `sku_barcodes` 는 대부분 셀메이트 11자리 내부코드다. 제조사 바코드(GTIN) 꼴은 수백 행뿐이라 포장 바코드를
찍어도 거의 못 찾는다. 셀메이트 백업(`01_현재고_전체_20261016.csv`)의 `바코드번호2` 칸에 GTIN 이 약 800행 있지만
33,920 품목 중 2.5% 라 효과가 작다 (그 칸은 `scripts/sellmate/import-products.ts` 가 버렸다 — 별건, §9).
이 작업은 어차피 모든 재고 SKU 를 손에 드므로, **제조사 바코드를 모을 가장 싼 기회**다. 작업이 끝나면 손 댄 SKU 는
입고·피킹 스캔에서도 찾힌다.

## 2. 목표 · 비목표 · 반목표

**목표**
- 작업자가 폰 브라우저(admin-web)만으로 선반 바코드 스캔 → SKU 선택 → 바코드·크기·사진 등록 → 다음 선반을 반복한다.
- 관리자가 작업자별 진행(오늘·누적)과 남은 SKU 수를 본다.
- 사진은 **원본 화질 그대로** 보관한다.

**비목표**
- 무게 측정 (저울이 따로 필요, 요청 없음).
- 검수 단계. **완료 판단은 작업자 자가 체크로 충분하다** (사용자 결정).
- core 의 진짜 로케이션(`locations`·재고 원장)에 셀메이트 위치를 들이는 것 (§4, 사용자 결정).
- 사진을 스토어프론트·썸네일에 쓰는 것.

**반목표 (이러면 기술적으로 돌아가도 실패)**
- 실측 사진이 기존 SKU 편집 흐름에서 지워진다 — `sku_images` 는 수정 시 통째로 지우고 다시 넣는다
  (`sku-catalog.manager.ts` 의 update). 그래서 실측 사진은 거기 두지 않는다.
- 찍은 바코드가 **다른 SKU 에 이미 붙어 있는데 조용히 옮겨진다** — 그 SKU 의 스캔이 깨진다.
- 작업자 계정이 이 페이지 밖의 마스터데이터를 고칠 수 있다.
- 폰 사진이 업로드 상한에 걸려 압축되거나 실패한다.

## 3. 사용자와 권한

- 작업자: `logistics_worker` 역할. 코드상 이 역할은 inventory 에서 `inventory.operate` 만 받는다
  (`apps/core/src/platform/auth/inventory-scopes.ts`). **이 기능의 새 core API 는 전부 `inventory.operate` 로 연다.**
  기존 `POST /skus/:id/barcodes`·`PUT /skus/:id` 는 `inventory.manage` 라 작업자가 못 쓴다 — 쓰지 않는다.
- core 의 새 라우트는 `@RequireScopes` 옆에 `@RequirePermission` 도 단다 (기존 라우트 관례,
  `sku-catalog.controller.ts`). 물류 역할은 이미 `inventory.stock.operate` 권한을 받는다
  (`libs/authorization/src/permissions/permission-catalog.ts`).
- admin-web 페이지 접근은 역할이 아니라 **권한 표**로 정해진다 (`apps/admin-web/src/lib/auth/screen-access.ts`,
  `RouteGuard`). 작업자 화면은 **폰 전용 영역 `/mobile` 아래**에 둔다 (`apps/admin-web/src/app/mobile/`).
  작업자에게는 `inventory.stock.read` 로 이미 `/inventory/*` 조회 화면 몇 개가 열리지만, 마스터데이터 쓰기는
  백엔드가 막는다 — 반목표에 어긋나지 않는다.
- 관리자 현황 페이지는 `admin`·`master` 가 여는 권한으로 둔다.
- **라이브 user-service 에 `logistics_worker` 역할 행이 없을 수 있다** (2026-09-25 실측 시 없음). 사용자가 만들어 부여한다
  (`db:seed:ref --deployment lcnine-auth`). 이건 배포 체크리스트 항목이지 이 기능의 코드가 아니다.
- 로그인 직후 행선지는 역할별 `landingPath` 가 정한다 (`apps/admin-web/src/lib/auth/landing.ts`,
  `apps/user-service/src/api/iam/roles/role-admin.manager.ts`). **`logistics_worker` 의 `landingPath` 를 이 페이지로
  설정**한다 — 코드가 아니라 배포 체크리스트 항목이다.

## 4. SKU 를 찾는 길: 셀메이트 선반 위치

core 는 상품의 실제 선반 위치를 모른다. 셀메이트 재고를 들일 때 전부 «입고 대기» 위치 하나에 넣었고
(`scripts/sellmate/sync-stock.ts`), 셀메이트의 `상품위치` 칸은 어디서도 읽지 않는다.

셀메이트 백업에는 위치가 잘 있다 (2026-10-16 백업 기준):
- 재고 있는 7,281 품목 중 6,811(94%)에 `상품위치` 가 있다. 형식은 거의 `T-01-20` 꼴.
- 위치 7,070곳 중 6,696곳(95%)이 품목 하나만 가리킨다. 최대 10개.
- 창고 선반에 위치 글자와 바코드가 붙어 있고, 위치는 잘 안 바뀐다 (사용자 진술).

**결정 (사용자): 이 작업 전용의 작은 표 「SKU ↔ 셀메이트 위치」를 따로 둔다.** 재고 원장·`locations`·피킹은
건드리지 않는다. 백업 CSV 에서 한 번 넣는 스크립트로 채운다.
- 키: CSV 의 `옵션정보일련번호` = `skus.code` (`import-products.ts` 가 그렇게 넣었다). 값: `상품위치` 원문(공백 정리).
- **`대표이미지주소`(42번 칸)도 같이 넣는다.** 작업자가 ②에서 사진으로 고르게 하려는 것이다. core 에는 이 이미지가 없다
  (`import-products.ts` 가 안 들였다). 재고 있는 7,281행 중 7,230행에 있고, 대부분 공개 CDN(네이버·자사·카페24 등)이다.
  `lcnine.sellmate.co.kr` 의 것도 2026-10-21 로그인 없이 200 으로 열렸다. 셀메이트 계약이 끝나면 그 몫은 깨질 수 있다 —
  이 작업 기간만 쓰는 값이라 감수한다. 깨진 이미지는 자리표시로 보이게.
- 한 SKU 에 위치 하나, 한 위치에 SKU 여럿.
- **② 선반 목록은 그 위치에 매핑된 SKU 를 재고와 무관하게 전부 보여 준다** (Claude 판단 — 선반에 실물이 있으면
  core 재고와 상관없이 작업할 수 있어야 한다).
- 형식이 이상한 값(`케이영 창고`, `A-9-99 뒤` 등 수십 행)도 그대로 넣는다. 검색이 정확일치라 해가 없다.
- CSV 는 cp949, 47컬럼, 값이 `="…"` 로 감싸여 있을 수 있다 — `scripts/sellmate/parse.ts` 의 처리와 맞출 것.

**선반 바코드는 로케이션 코드를 평문으로 인코딩한 것이다** (사용자 확인, 2026-10-21). 스캔 값을 그대로(앞뒤 공백만 정리)
위치 표에서 정확일치로 찾으면 된다.

위치가 없는 재고 SKU(약 470개)를 위해 **이름·코드 검색**을 보조 경로로 둔다. 기존 `GET /inventory/skus` 검색을 쓴다 —
`inventory.operate` + `inventory.stock.read` 라 작업자에게 열려 있다 (`sku-catalog.controller.ts`).

## 5. 작업자 화면 (폰)

목업: `.superpowers/brainstorm/*/content/flow.html`, `flow-v2.html` (git 무시 경로, 로컬 참고용).

**① 시작** — 큰 「선반 바코드 찍기」 버튼, 「위치 직접 입력」, 「이름·코드로 찾기」. 「오늘 내가 끝낸 상품 N개」 — `GET inventory/sku-field-capture/me/today` (작업자 본인 범위, stock.read + OPERATE).

**② 선반 T-01-20** — 그 위치의 SKU 목록. 각 줄에 셀메이트 대표 이미지(있으면), 이름, 코드,
**완료 여부 + 완료했다면 누가·언제**. 상품이 하나뿐이어도 목록을 보여 줄지 바로 ③으로 갈지는 구현자 몫이지만,
**이미 완료된 SKU 를 고르면 「OO 님이 10-21 에 완료함」을 눈에 띄게 보여 주고 다시 작업할지 묻는다** (사용자 요청).

**③ 상품 작업** — 한 화면에 세 칸:
- **바코드 (셋 중 하나 필수):**
  - 「제조사 바코드 찍기」 → 찍은 값을 그 SKU 에 붙인다.
  - 「제조사 바코드 없음 · 자체 스티커 있음」.
  - 「바코드 아예 없음 (스티커 필요)」 → 관리자 현황의 「스티커 필요」에 잡힌다.
  - 이 칸의 목적: 「안 찍음」이 «잊음»인지 «없음»인지 구별한다.
- **포장째 크기 (mm):** 가로·세로·높이 세 칸, 양의 정수.
- **사진 (자유 촬영, 3장 이상) + 「여섯 면이 모두 한 장 이상에 나왔어요」 체크 하나** (사용자 선택 A).
  찍은 사진은 썸네일로 보이고 지울 수 있다.
- 「완료 → 다음 선반」은 위 조건이 다 찼을 때만 누를 수 있다.
- **사진은 올리는 즉시 SKU 에 붙는다** (완료 전에도). 완료 판정의 «3장 이상»은 서버에 붙은 사진 수로 센다.
- **재작업:** 마지막 기록의 mm·바코드가 초안으로 채워지지만 「여섯 면」 체크는 다시 눌러야 한다.

**스캔:** admin-web 에는 카메라 바코드 스캔이 아직 없다. 폰 카메라로 선반 바코드와 제조사 바코드를 읽어야 한다.
iOS Safari 는 브라우저 `BarcodeDetector` 가 없어 라이브러리가 필요하다 — 고르는 건 구현자 몫. 블루투스 스캐너
(키보드 입력)도 같은 입력칸으로 들어오게 하면 덤으로 된다.

## 6. 데이터

모두 core `inventory` BC. 새 테이블·컬럼은 추가만 한다 (expand, 1 PR 가능 — `migrate → deploy` 순서).

**6.1 포장 크기** — `skus` 에 mm 정수 새 컬럼 셋(nullable). 이름은 구현자 몫(예: `package_width_mm` …).
기존 `dimension_width/height/depth`(cm 정수)는 **건드리지 않는다** — 1cm 해상도라 작은 상품엔 거칠다.
옛 칸을 정리할지는 별건.

**6.2 실물 사진** — 새 테이블 (예: `sku_reference_photos`): `sku_id`, file-service 파일 id, 정렬, 찍은 사람, 찍은 시각.
- 업로드는 file-service **presign 직행** (`POST /files/upload/presign` → PUT → `/files/upload/confirm`).
  admin-web 의 프록시 경유 업로드는 Lambda 페이로드 상한 때문에 **약 4.7MB 에서 413** 이 나고 그 413 은 어느 로그에도
  안 남는다. 폰 원본은 3~10MB 다. **압축하지 않는다.** admin-web 에 presign 클라이언트가 이미 있다
  (`apps/admin-web/src/lib/api/domains/files/upload.client.ts`). **⚠️ 이 클라이언트는 기본으로 webp 압축을 한다 —
  `compress: false` 를 넘겨야 원본이 간다.** presign·confirm 은 `@StoreRoute` 라 작업자도 부를 수 있다.
- 새 file context 를 만든다 (예: `sku-reference-photo`, **공개 전용**(`allowPublic: true, allowPrivate: false`),
  상한 넉넉히 예: 25MB). `apps/file-service/src/database/default-file-contexts.ts` 에 더한다.
  **file_contexts 는 시드다 — 배포 뒤 file-service 에 `db:seed:ref` 를 안 돌리면 업로드가 404** 다.
- **공개로 두는 이유 (사용자 결정, 2026-10-21):** 비공개 파일은 올린 본인과 `master` 만 열 수 있고
  (`apps/file-service/src/access/file-access.ts`), 「직원은 남의 파일도 연다」 예외의 직원은 `admin`·`master` 뿐이라
  작업자 B 가 A 의 사진을 못 본다. 공개면 file-service 를 고칠 게 없다. 주소는 UUID 라 추측할 수 없고, 상품 실물
  사진이라 감출 정보가 없다. `product-image` 와 같은 방식이다.
- **사진 지우기 = core 에서 SKU 와의 연결만 끊는다** (Claude 판단). file-service 삭제는 올린 본인·`master` 만 되므로
  부르지 않는다. 파일은 저장소에 남는다 — 이 작업 규모에선 무시해도 되는 양이다.
- **iPhone 기본 촬영 포맷은 HEIC 다.** 브라우저가 JPEG 로 바꿔 주는지, context 의 허용 MIME 에 HEIC 를 넣을지
  실기로 확인할 것.

**6.3 제조사 바코드** — 기존 `sku_barcodes` 에 보조 바코드(`is_primary=false`, `packing_unit` NULL)로 넣는다.
- `sku_barcodes.barcode` 는 전 SKU 에 걸쳐 unique 다 — 충돌 검사를 insert 앞에서 해야 한다 (안 하면 insert 가 터진다).
- SKU 편집(`PUT /skus/:id`)은 공급사·카테고리·이미지만 지우고 다시 넣고 바코드는 안 건드린다 — 여기 두는 게 안전하다.
- **모든 스캔 조회는 정확일치다** (`fulfillment/services/sku-barcode-resolution.ts`, `inbound/services/inbound.service.ts`).
  폰 스캔 라이브러리가 UPC-A(12자리)를 앞에 0 붙인 13자리 EAN 으로 돌려주면, 저장값이 피킹 때 핸드 스캐너 값과
  안 맞는다. 라이브러리가 돌려주는 형식을 실기로 확인하고, 핸드 스캐너와 같은 값이 저장되게 맞출 것.
- 같은 SKU 에 이미 있으면 아무것도 안 한다.
- **다른 SKU 가 그 바코드를 갖고 있으면 붙이지 않고, 작업자에게 그 SKU(이름·코드)를 보여 주며 경고한다.**
  작업자는 그 상태로도 이 SKU 작업을 완료할 수 있다 — 충돌은 기록에 남겨 관리자가 볼 수 있으면 좋다(구현자 판단).
- 라이브에 `="…"` 엑셀 찌꺼기째 저장된 바코드가 있다(2.9만 행). 충돌 검사는 저장된 값 그대로 비교하면 된다 —
  정리는 별건.

**6.4 완료 기록** — 새 테이블, **SKU 당 한 줄**: 바코드 상태(찍음/제조사 없음·스티커 있음/아예 없음),
찍은 바코드 값(있으면), 「여섯 면」 체크, 마지막 작업자, 최초·마지막 완료 시각.
- 완료한 SKU 도 누구나 다시 열어 고칠 수 있다. 다시 완료하면 이 줄을 덮어쓰고 마지막 작업자가 바뀐다.
- 작업자별 「오늘·누적」을 세려면 덮어쓰기만으로는 부족할 수 있다 (재작업이 앞 사람 수를 지운다). 완료 이벤트를
  따로 남길지는 구현자 판단 — 단 **관리자가 보는 수치는 «그 작업자가 완료 버튼을 누른 SKU 수»** 로 이해되게.
- 저장(크기·바코드·완료 기록·사진 연결)은 한 트랜잭션. 사진 파일 업로드 자체는 그 앞에 끝나 있다.

## 7. 관리자 현황 (PC, admin-web)

- **남은 SKU**: core 원장 기준 ON_HAND 재고가 있는 SKU(**모든 창고 합**) 중 완료 기록이 없는 수.
  (Claude 판단 — 셀메이트 백업이 아니라 core 기준. 셀메이트 재고는 전부 한 창고로 들어와 있어 창고 구분은 지금 차이가 없다.
  재고 0 SKU 를 완료하면 「완료」에는 잡히지만 「남은 SKU」 분모에는 안 들어간다.)
- **완료** 수, **스티커 필요** 수(바코드 아예 없음으로 완료된 SKU).
- **바코드 충돌** 수 (찍은 바코드가 다른 SKU 에 이미 붙어 있던 건).
- **작업자별 오늘·누적 완료 수.** 「오늘」은 KST 기준.
- 숫자는 DB 에서 집계해 돌려준다 (클라이언트에서 행을 세지 않는다).
- 「스티커 필요」 목록을 클릭해 볼 수 있으면 좋다 — 구현자 판단.

## 8. 남은 결정 (구현자 몫)

테이블·컬럼·엔드포인트 이름, 폰 화면 세부 배치, 스캔 라이브러리, 위치 적재 스크립트 형태(`scripts/sellmate/` 아래 권장,
DRY_RUN 지원), 완료 이벤트 기록 여부.

## 9. 별건으로 남길 것 (이 작업 범위 밖)

- 셀메이트 `바코드번호2` 의 GTIN 약 800행 들여오기.
- `="…"` 찌꺼기 바코드 정리 (498 SKU 는 정상 쌍둥이가 없어 스캔 불가).
- 옛 cm 크기 컬럼 정리.

## 10. 배포 체크리스트

순서가 중요하다 (CLAUDE.md «Expand phase»: `migrate → deploy`). 라이브 작업은 터널(`cd deployments/lcnine/services && npx sst tunnel --stage live`)을 사용자가 먼저 띄운 상태에서 한다.
배포 직전 `npm run deploy:preflight -- --stage live` 로 대기 마이그를 확인한다.

1. **core 마이그 (추가만, 배포보다 먼저).** 파일 `apps/core/drizzle/20261020180759_add-sku-field-capture.sql`.
   `npm run db:migrate -- --stage live --deployment lcnine-services --yes` → 그 다음 `sst deploy` (services).
2. **file-service context 시드.** file-service 는 `lcnine-services` 배포 소유(`deployments/lcnine/services/infra/services.ts`).
   새 context `sku-reference-photo` 는 시드라 마이그로 안 들어간다 — 없으면 업로드 404.
   `npm run db:seed:ref -- --stage live --deployment lcnine-services --yes` (코드: `apps/file-service/src/database/default-file-contexts.ts`).
3. **위치 적재 스크립트 1회** (마이그 적용 뒤). 셀메이트 재고 백업 CSV 로 — DRY_RUN 먼저, 통계 확인 후 실제 반영. 같은 파일을 다시 돌려도 안전(sku_id upsert).
   `DRY_RUN=1 bash scripts/sellmate/run.sh live load-shelf-positions ~/다운로드/01_현재고_전체_YYYYMMDD.csv`
   `bash scripts/sellmate/run.sh live load-shelf-positions ~/다운로드/01_현재고_전체_YYYYMMDD.csv`
   (`run.sh` 가 RDS·시크릿으로 `DATABASE_URL` 을 만든다 — `scripts/sellmate/README.md`. 매칭 안 된 SKU 코드 수를 확인한다.)
4. **admin-web 배포.** 새 의존성 `@zxing/browser` 0.1.5, `@zxing/library` 0.21.3 — 머지 뒤 메인 체크아웃에서 `(cd apps/admin-web && npm ci)` 후 배포.
5. **lcnine-auth 역할.** `logistics_worker` 역할 행이 라이브 user-service 에 있는지 확인한다(2026-09-25 에는 없었다). 없으면
   `npm run db:seed:ref -- --stage live --deployment lcnine-auth --yes` 또는 어드민의 역할 관리로 만든다.
   **역할을 만드는 것만으로는 권한이 붙지 않는다.** 시드는 `roles` 행만 넣고(`scripts/seeding/steps/user-service.seed-step.ts`
   의 `USER_SERVICE_REFERENCE_ROLES`, apply Step 1), 카탈로그의 `grant` 는 권한 키가 **처음 등록될 때 그 순간 있던 역할에만**
   부여된다(`apps/user-service/src/api/iam/permission-catalog-sync.manager.ts` 의 `grantFirstRegistrations` — 없던 역할은
   `missingRoles` 로 건너뛴다). `inventory.stock.*` 는 이미 등록돼 있으니 나중에 만든 `logistics_worker` 엔 아무것도 없다.
   (스코프 `inventory.operate` 는 역할 이름 기준 매핑 `INVENTORY_ROLE_MAPPINGS` 라 따로 할 일이 없다.)
   1. 어드민 역할 관리(`/users/roles` → `logistics_worker`)에서 `inventory.stock.read`(재고 조회)와
      `inventory.stock.operate`(재고 현장 작업)를 부여한다.
   2. 작업자 계정에 `logistics_worker` 를 부여하고, 그 역할의 `landingPath` 를 `/mobile/sku-field-capture` 로 설정한다 (코드 변경 없음).
   3. **작업자 계정으로 로그인해 확인한다**(브라우저 로그인은 사용자가 직접):
      `/mobile/sku-field-capture` 가 열리고 `GET /inventory/sku-field-capture/me/today` 가 200 이다.
      관리자 현황 `/inventory/sku-field-capture`(API `GET /inventory/sku-field-capture/progress` —
      `inventory.master.read` + 스코프 `inventory.manage`)은 **열리지 않아야** 한다.
6. **실기 스모크 (iPhone·Android 각각):**
   - 카메라로 선반 바코드 스캔 → 그 위치의 SKU 목록.
   - 사진 3장 이상: 올라간 파일이 **원본 크기 그대로**인지 file-service 메타데이터로 확인 (압축·거부 없음). iPhone 사진이 JPEG 로 오는지(HEIC 아님).
   - 제조사 바코드 카메라 스캔. 12자리 UPC 상품이 있으면 핸드 스캐너 값과 같은지.
   - 「여섯 면」 체크 → 완료 → 관리자 현황(`/inventory/sku-field-capture`)에 반영.
   - 폰 폭 360px 에서 하단 내비가 잘리지 않는지.

## 11. 로컬 검증 메모

통합 스펙(`sku-field-capture.manager|reader.integration.spec.ts`)은 로컬 스크래치 DB `core_skufc` 에서 돌렸다 —
공유 로컬 `core` DB 의 마이그레이션 저널이 낡아 새 마이그를 얹을 수 없었다.
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_skufc npx jest --runTestsByPath <두 스펙>`.
