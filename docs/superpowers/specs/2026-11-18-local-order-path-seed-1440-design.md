# 로컬 E2E — 자사몰 주문이 상자·출고·Medusa 반영까지 가는 시드 (#1440)

- 날짜: 2026-11-18
- 이슈: [#1440](https://github.com/LCNINE/almondyoung-server/issues/1440) (부모 #1233)
- 상태: 설계

## 1. 왜

로컬 E2E 에서 «자사몰 주문 하나가 끝까지 가는» 경로를 재현할 수 없다. 지금까지 성공한 길은 어드민에서 손으로
상품을 만들고 발행하고, 시드를 다시 돌리고, 매칭을 손으로 하는 것뿐이었다(`docs/local-e2e-environment.md` §8-C~E).
매칭과 출고는 화면으로 끝까지 간 적이 없다.

이 경로를 기다리는 일:

- 비상 출고 경로의 Medusa 반영 확인(#1249). 도구는 끝났고, 이 시드가 없어서 «정식 1상자 + 비상 나머지 → 비교»를 못 하고 있다.
- 컷오버 런북 리허설(#1251), 셀메이트 저녁 맞추기(#1304), 앞으로의 출고·반품 로컬 실측.

**완료 조건 (이슈 그대로)**

1. 새로 만든 로컬 환경에서 브라우저 없이 명령만으로 자사몰 주문 한 건이 부천 상자(재고 예약됨)까지 온다.
2. 그 상자를 창고 앱(정식) 또는 비상 출고 경로(#1249)로 내보내면 Medusa 주문에 송장이 반영된다.

## 2. 목표 · 비목표 · 반목표

**목표**

- 스택이 뜬 뒤(`start:all:local`) 도는 명령 둘:
  - **상품 준비**: 주문 가능한 자사몰 상품을 멱등으로 갖춘다.
  - **주문 넣기**: 자사몰 주문을 N건 넣고, 부천 상자가 서고 재고가 예약될 때까지 기다린다.
- 로컬에서 송장 발급이 바깥으로 나가지 않고 끝까지 되게 하는 **가짜 한진 서버**.
- `preflight:e2e:local` 이 «주문 가능한 상품 있음»과 «가짜 한진이 떠 있음»을 판정한다.
- `docs/local-e2e-environment.md` 에 새 명령과 «주문 한 건을 끝까지» 절차를 적는다.

**비목표**

- 마켓(네이버·쿠팡) 주문. 2단계(#1306)의 일이다.
- `seed-dev-core` 의 합성 주문·상자 시나리오를 바꾸기.
- 테넌트 2(`rehearsal`) 주문. 테넌트 1 만 한다.
- 출고 자체를 자동화하기. 완료 조건 ②의 «내보내기»는 사람이 창고 앱으로, 또는 #1249 도구로 한다. 이 작업은 내보낼 상자를 만들어 줄 뿐이다.
- 배송 완료 흉내. 가짜 한진의 배송 조회는 «아직 스캔 안 됨»만 돌려준다(§5.1).

**반목표 (기술적으로는 돌아가도 실패로 보는 것)**

- 로컬 스택이 사람 모르게 실제 한진을 부르는 것. 실제 한진은 명시적으로 고를 때만 부른다.
- 다시 돌릴 때마다 상품·매칭·SKU·재고가 늘어나는 것.
- DB 에 직접 써서 «된 것처럼» 만드는 것. 그러면 outbox → channel-adapter → Medusa 투영이 생기지 않아, 리허설이 실제 경로를 검증하지 못한다.
- preflight 가 무언가를 고치는 것. 판정자가 고치면 초록불이 «원래 옳았다»는 증거가 되지 못한다(CLAUDE.md).
- 공개 레포에 테넌트 값(발송인 이름·주소·연락처, 실제 계약번호·키)을 적는 것.

## 3. 제약

- **공개 레포다.** 템플릿·스텁·문서에 들어가는 발송인·계약 값은 자리표시자(`로컬 발송인`, `0000000` 등)만 쓴다.
- **판정은 DB·API 로 한다.** 화면과 로그를 성공 증거로 쓰지 않는다(문서 §6-④, §7).
- 로컬 전용 스크립트는 접속 대상이 localhost 가 아니면 거부한다(`seed-user-service-local.ts` 의 가드와 같은 방식).
- 앱↔`.env`↔포트의 정본은 `scripts/local/e2e-env-map.sh` 다. 새 포트도 정본 한 곳에만 적는다.
- 검증 게이트(`type-check`·`npx jest`)가 0 으로 남아야 한다. 스펙을 추가하면 DB·스택이 없는 기본 실행에서 skip 되게 가드를 단다. 스펙 안에서 `dotenv.config()` 를 부르지 않는다.
- E2E 스택이 떠 있는 동안에는 전체 jest·type-check 를 돌리지 않는다(메모리 부족 재부팅 전례). 대상 스펙만 돌린다.

## 4. 접근

| | 접근 | 판단 |
|---|---|---|
| **A** | **가짜 한진을 별도 프로세스로 띄우고(sms-stub 처럼), 상품 준비·주문 넣기는 HTTP 를 부르는 스크립트로** | **채택** (사용자 결정) |
| B | core 안에 가짜 송장 발급기를 두고 env 로 켜기 | 제외. 실제 한진 클라이언트(HMAC 서명·응답 해석·오류 코드 분기)를 타지 않아 리허설이 놓치는 게 생기고, 운영 코드에 가짜가 섞인다 |
| C | `seed-dev-core` 를 넓혀 DB 에 직접 쓰기 | 제외. outbox 가 돌지 않아 Medusa 투영·수집이 생기지 않는다. 이슈가 이미 배제했다 |

송장 번호를 어디서 받을지는 사용자가 정했다: **가짜 한진 서버를 만들어 커밋한다**(실제 한진 스테이징 키를 각자 넣는 안은 버렸다).
이유: 새로 만든 환경에서도 완료 조건 ②가 성립하고, 리허설을 여러 번 돌려도 실제 한진 번호를 쓰지 않는다.

## 5. 설계

### 5.1 가짜 한진 — `scripts/local/hanjin-stub.(js|ts)`

**#1249 브랜치(`feat/1249-emergency-outbound`, draft PR #1434)에 같은 일을 하는 스텁 `scripts/ops/emergency-outbound/local/fake-hanjin.ts` 가 이미 있다.**
(내 결정) 이 작업은 그걸 `scripts/local/` 로 옮겨 정본 하나로 만든다:

- 포트 4599, 번호 `91` 접두 12자리, 분류 칸 `seed-dev-core` 의 `DEV_HANJIN_SORT_FIELDS` 값을 그대로 이어받는다. 서명 헤더는 찍지 않는다(키가 실린다).
- 그 위에 아래 표의 동작 둘(같은 `custOrdNo` 재전송에 `ERROR-09`, 같은 `msg_key` 에 같은 번호)을 더한다.
- 순서는 사용자가 정한 대로 **#1440 이 먼저 develop 에 들어간다.** #1249 는 그 뒤 rebase 하면서 자기 `fake-hanjin.ts` 를 지우고 `scripts/local` 의 스텁과 start-all 배선을 쓴다. 이 일은 #1249 쪽에서 한다(이 PR 은 #1249 브랜치를 건드리지 않는다).
- 파일 확장자(`.js` 로 node 직접 실행할지, `.ts` 를 `tsx` 로 띄울지)는 빌더 판단이다.

의존성 없는 Node http 서버다. core 의 `HanjinCarrierGateway`
(`apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts`)가 부르는 네 곳을 흉내 낸다.
주문 호스트(`HANJIN_ORDER_BASE_URL`)와 출력 호스트(`HANJIN_PRINT_BASE_URL`)는 같은 스텁 주소를 가리켜도 된다(경로가 겹치지 않는다).

| 경로 | 돌려줄 것 |
|---|---|
| `POST /v1/wbl/:clientId/print-wbl` (송장 번호 받기) | `result_code: 'OK'`, `wbl_num`(12자리), 라벨 칸(`LABEL_FIELDS`: `s_tml_nam`·`tml_cod`·`zip_cod` …)에 그럴듯한 고정값 |
| `POST /parcel-delivery/v1/order/insert-order` | 출고(`svcCatCd: 'S'`)는 `resultCode: 'OK'`. 같은 `custOrdNo` 를 다시 받으면 `ERROR-09`(이미 등록됨). 회수(`'R'`)는 `OK` + `wblNo` |
| `POST /parcel-delivery/v1/order/cancel-order` | `resultCode: 'OK'` |
| `POST /parcel-delivery/v1/tracking/tracking-wbl` | `resultCode: 'ERROR-01'`. 게이트웨이가 «아직 스캔 안 됨»(빈 이력)으로 읽는다 |

- **송장 번호는 12자리**(한진 번호는 항상 12자리, 사용자 확인). 재기동해도 겹치면 안 된다. 같은 `msg_key` 로 다시 요청하면 같은 번호를 돌려준다.
  - 번호를 어떻게 만들지(시각 기반이든, 파일에 저장한 카운터든)는 빌더가 정한다.
  - core 는 번호 체크디지트를 검사하지 않는다(2026-11-18 grep 확인). 그래서 스텁도 체크디지트를 맞추지 않아도 된다.
- 서명(HMAC)은 검사하지 않는다. 받은 요청은 한 줄씩 stdout 에 찍는다(`logs/hanjin-stub.log`).
- 라벨 칸 값의 모양은 `docs/hanjin-api-integration-reference.md` 와 게이트웨이 스펙의 픽스처를 따른다. 라벨 렌더러(스테이션 TX400·ZPL)가 그 값으로 그려져야 한다.
- 오류를 흉내 내는 스위치(예: #1241 실측 때 손으로 만든 «insert-order 503»)는 **이번 범위 밖**이다. 필요해지면 env 하나로 더한다. 빌더 판단으로 넣어도 되지만 필수는 아니다.

**배선 (내 결정 — 고칠 수 있음)**

- `start-all.sh` 가 sms-stub 옆에서 가짜 한진을 띄운다. 포트는 정본(`e2e-env-map.sh`)에 한 줄로 둔다.
- **기존 개발자 `.env` 에는 실제 한진 주소와 키가 들어 있다.** 그래서 템플릿만 고쳐서는 부족하다. `start-all.sh` 가 core 를 띄울 때 `HANJIN_ORDER_BASE_URL`·`HANJIN_PRINT_BASE_URL` 을 셸 env 로 스텁 주소로 덮는다. 셸 값이 `.env` 를 이긴다(2026-11-09 #1241 실측).
  - 실제 한진이 필요할 때(한진 검수용 `seed-hanjin-samples.ts` 등)는 `E2E_HANJIN=real npm run start:all:local` 로 덮어쓰기를 끈다. 이때 start-all 이 «실제 한진을 부른다»고 한 줄 경고한다.
- **새 환경**: `env-templates/.env.core.local.example` 에 `isHanjinConfigured` 가 요구하는 `HANJIN_*` 13개를 자리표시자로 채운다(주소는 스텁, 키·계약번호는 더미, 발송인은 `로컬 발송인` 같은 가짜 값). 필수 목록은 `hanjin.config.ts` 의 `missingHanjinConfig` 다.
- preflight: 스텁 포트가 열려 있는지, core 가 바라보는 한진 주소가 스텁인지 판정한다. 실제 한진이면 `!`(경고)로 표시하고 실패로 보지 않는다.

### 5.2 상품 준비 — `scripts/local/order-path/` (명령 이름은 내 결정: `npm run seed:order-path:local`)

전부 HTTP 로 한다. 직원 토큰은 `scripts/tenancy/staff-token.ts` 의 `signInStaff`(로컬 `admin` / `Rehearsal1234!`)로 받는다.
상품 생성·발행 호출은 `scripts/tenancy/isolation-check/checks.ts` 가 선례다(`POST /masters` → `PUT /masters/:m/versions/:v` → `PATCH …/publish`).

순서:

1. **상품 찾기 또는 만들기.** 고정 식별자로 찾는다. 상품 2개(단일 품목 1개 + 옵션 2개짜리 1개 정도. 개수와 모양은 빌더 판단)를 «[E2E] 주문 경로 …» 이름으로 만든다.
   - 무엇을 고정 식별자로 쓸지(상품 코드 칸, 혹은 이름)는 빌더가 core 스키마를 보고 정한다. 다시 돌렸을 때 두 벌이 되지 않는 것이 기준이다.
2. **판매가.** 기본 정보의 공급가·시장가는 판매가가 아니다. 가격 정책을 따로 넣는다. 안 넣으면 0원 상품이 그대로 팔린다(문서 §8-D).
3. **발행** → **Medusa 투영 확인.** Medusa admin API 로 그 상품의 variant 를 조회해 `metadata` 에 `pimVariantId`, product `metadata` 에 `pimMasterId`·`pimVersionId` 가 생길 때까지 기다린다. 제한 시간을 넘기면 어느 칸이 비었는지 적고 실패한다.
4. **SKU.** 부천에서 출고할 실물(physical) SKU 를 찾거나 만든다. 실물 SKU 는 배송 프로필이 필요하다(isolation-check 주석).
5. **재고.** 부천 창고의 한 위치에 «목표 수량까지 채우기». 현재 가용 수량을 읽고 모자란 만큼만 `POST /inventory/stocks/adjust`(+delta)로 넣는다.
   - 다시 돌려도 늘지 않고, 주문으로 줄었으면 다시 채운다.
   - 목표 수량(예: 100)과 위치 고르는 법은 빌더 판단이다. 창고·구역은 `db:seed:core:local`(`WmsSeedStep`)이 이미 만든다.
6. **매칭.** variant → SKU(배수 1)를 `PUT /matchings/:variantId`(또는 대기 행이 있으면 `PATCH /matchings/:id/resolve`)로 맞춘다.
   - 발행이 대기 매칭 행을 만들지 않는 경우가 있다(문서 §8-D: `ProductMatchingBackfillSeedStep` 이 채운다). 빌더는 API 로 행 없이 매칭이 되는지 먼저 확인한다.
   - 안 되면 «먼저 `npm run db:seed:core:local`» 로 안내하고 멈추거나, 스크립트가 그 명령을 부른다. 매칭 행은 outbox 가 필요 없는 core 내부 행이라 이 단계만은 DB 시드여도 반목표에 걸리지 않는다.
7. 끝에 사람이 읽을 요약을 찍는다: 상품 id·Medusa variant id·SKU·부천 가용 수량·매칭 상태.

### 5.3 주문 넣기 — 같은 디렉터리 (명령 이름은 내 결정: `npm run order:place:local -- --count N`)

1. **상품 준비를 먼저 멱등으로 부른다**(§5.2). 이미 갖춰져 있으면 몇 초 안에 지나간다.
2. **구매자 확보.** 고정 아이디(예: `e2e-order-buyer`)가 없으면 user-service 회원가입 API 로 만든다.
   - 폰 인증 코드는 sms-stub 이 받은 것을 `user_service.phone_verifications` 에서 읽는다(문서 §5). 이미 있으면 그대로 쓴다.
   - 적립금은 기존 `seed-points-local.ts`(`LOCAL_POINT_LOGIN_IDS=<그 아이디>`)로, 주문 금액보다 모자랄 때만 채운다.
3. **고객 토큰.** `tokenForUser` 로 스토어프론트 OAuth 클라이언트의 토큰을 받는다. Medusa 의 `my-auth` 프로바이더가 Bearer 로 그걸 받는다(`apps/medusa/src/modules/auth/service.ts`).
   - Medusa 고객(customer)이 아직 없으면 만드는 호출이 필요하다. 스토어프론트가 로그인할 때 하는 것과 같은 호출을 빌더가 찾아 따른다.
4. **Medusa 장바구니 → 결제 → 주문.** 스토어프론트 체크아웃이 부르는 store API 순서 그대로 간다.
   - 순서: 장바구니(publishable key·한국 region) → 상품 담기 → 배송지·이메일 → 배송 옵션 → payment collection → `almond-payment` 세션 → wallet `POST /v1/payment-intents/:id/confirm`(POINTS 결제수단, 고객 JWT) → 장바구니 완료.
   - 배송지는 공공기관 주소처럼 공개된 실주소를 쓰고, 배송 요청사항은 «비밀번호없이 출입 가능해요»로 둔다(문서 §8-F ②).
   - **(내 결정) 주문마다 배송지를 다르게 한다.** core 는 «고객·배송 프로필·주소»가 같은 상자를 합배송 묶음으로 본다(`consolidation-board.reader.ts` 의 `groupConsolidationBoard`). 그런 상자는 출고 준비에서 `mergeable` 로 분류되고, #1249 비상 도구는 «합칠 수 있는 상자 — 비상 경로에서 뺌»으로 뺀다. 같은 주소로 N건을 넣으면 «정식 1 + 비상 나머지» 비교가 성립하지 않는다.
     - 구매자는 하나로 두고 주소만 바꾼다. 공개 실주소 몇 개를 목록으로 두고, 상세주소에 주문 순번을 붙인다. 주소 키가 상세주소까지 보는지는 빌더가 `recipientAddressKey` 로 확인한다. 안 본다면 기본주소를 바꾼다.
     - 합배송 묶음을 일부러 만드는 옵션은 이번 범위 밖이다.
   - 지연 승인(`ALMOND_DEFERRED_APPROVAL`)이 켜진 상태에서 포인트 결제가 되는 길은 2026-09-06 에 화면으로 통과했다(§8-E). 같은 호출 순서를 따르면 된다.
5. **즉시 수집.** 5분 폴링을 기다리지 않는다. channel-adapter `POST /adapter/orders/medusa/:orderId/sync`(`CHANNEL_ADAPTER_INTERNAL_KEY`)를 부른다.
6. **부천 상자까지 기다린다.** core 백로그 워커(10초 주기)가 출고 주문·상자를 만들고 재고를 예약한다. 판정은 core API 로 한다: 그 주문의 상자가 부천 창고에 있고 예약 상태다. 제한 시간을 넘기면 어디서 멈췄는지(주문 없음 / 격리 / 매칭 대기 / 출고 주문 없음 / 예약 없음) 적고 실패한다.
   - 격리는 `order_collection_failures`, 매칭 대기는 `sales_orders`·매칭 상태로 본다.
7. `--count N` 이면 1~6 을 N번 한다(#1249 는 «정식 1상자 + 비상 나머지»가 필요하다). 끝에 Medusa 주문 id·core 주문 id·상자 id 목록을 찍는다.
   - 상자 id 는 쉼표로 이은 한 줄도 함께 찍는다. #1249 의 `local/compare.ts --normal <id,…> --emergency <id,…>` 에 그대로 붙일 수 있게 하려는 것이다.

### 5.4 preflight (내 결정)

`preflight-e2e.sh` 에 판정을 더한다. 읽기만 한다:

- 가짜 한진 포트가 열림. 아니면 ✗, 고치는 명령은 `start:all:local`.
- core 가 바라보는 한진 주소가 스텁. 실제 한진이면 경고만 한다.
- «주문 가능한 상품 있음»: [E2E] 상품이 발행돼 있고, Medusa 에 식별자 셋이 투영돼 있고, 매칭돼 있고, 부천 가용 재고가 1 이상. 아니면 ✗, 고치는 명령은 `seed:order-path:local`.

이 판정은 «주문 경로 리허설을 할 사람»만 필요한 것이다. 그래서 다른 판정처럼 실패로 셀지, 경고로만 둘지는 빌더 판단이다. 내 제안은 경고다 — 상품 없이도 다른 E2E 는 할 수 있기 때문이다.

### 5.5 세 명령과의 관계 (내 결정)

```
npm run bootstrap:e2e:local    # ① 만든다 — 앱이 뜨기 전이라 여기서 상품을 못 만든다
npm run start:all:local        # ② 띄운다 — 가짜 한진도 함께. 끝나지 않는 명령이라 시드를 싣지 않는다
npm run preflight:e2e:local    # ③ 판정한다 — 주문 가능한 상품·가짜 한진을 «재기만» 한다
npm run seed:order-path:local  #    상품 준비(멱등). 보통은 아래가 알아서 부른다
npm run order:place:local -- --count 3   # 주문 넣기 → 부천 상자 id 출력
```

그다음 사람이 그 상자를 창고 앱(정식) 또는 #1249 도구로 내보낸다.
**완료 조건 ②의 판정**: Medusa admin `GET /admin/orders/:id` 의 `metadata.coreShippingStatus = 'shipped'`, `metadata.coreTrackingNumber` = 가짜 한진이 준 12자리 번호.
이 값은 channel-adapter 가 출고 이벤트를 받아 `updateOrderShippingProjection` 으로 쓴다(`apps/channel-adapter/src/adapters/medusa/medusa.client.ts`).
#1249 의 `local/compare.ts` 가 로컬 core·Medusa DB 에서 이 두 칸까지 이미 비교한다. 그래서 이 작업에는 «Medusa 반영 상태 보기» 부명령을 두지 않는다(내 결정).
#1249 가 머지되기 전에 ②를 확인할 때는 §5.6 의 문서 절에 적을 SQL 한 줄로 본다.

### 5.5-B 테넌트 모드 (내 결정)

두 명령과 preflight 판정은 ① 모드(기본)와 ② 모드(`E2E_GATE_MODE=reject npm run start:all:local`) 양쪽에서 통과해야 한다. 라이브가 ② 모드라 컷오버 리허설(#1251)은 ② 로 할 가능성이 크다.
테넌트 1 토큰과 테넌트 1 도메인으로만 부르면 두 모드 모두 같은 길을 타야 한다. 계획의 마지막 확인에 «두 모드에서 한 번씩 주문 넣기»를 넣는다.

### 5.6 문서

`docs/local-e2e-environment.md`:

- §2 세 명령 옆에 두 명령과 가짜 한진을 적는다. §9 «신설한 것» 표에 파일을 더한다.
- 새 절 «주문 한 건을 끝까지»: 주문 넣기 → 상자 → 창고 앱 또는 #1249 로 내보내기 → Medusa 반영 확인 쿼리.
- 기존 §8-D(손으로 상품 만들기)는 «명령으로 대체됨, 화면을 직접 볼 때만»으로 낮춘다.
- `E2E_HANJIN=real` 과 «실제 한진을 부르는 건 이때뿐»을 적는다.

CLAUDE.md 의 «로컬 전 과정(E2E)» 절에 두 명령을 한 줄씩 더한다.

## 6. 빌더에게 맡기는 것

- 스크립트의 파일 나눔, 모듈 이름, 재시도·제한 시간 값.
- 상품의 고정 식별자, 상품 개수와 옵션 모양, 재고 목표 수량, 부천 위치 고르는 법.
- 판매가를 넣는 API, 실물 SKU 의 배송 프로필 지정 방식, Medusa 고객을 만드는 호출. 전부 어드민·스토어프론트가 실제로 부르는 것을 찾아 따른다.
- 매칭 행이 없을 때의 처리(§5.2-6 의 두 갈래 중 하나).
- 가짜 한진의 번호 생성 방식과 라벨 칸 값.
- 스펙 범위. 최소한 가짜 한진의 응답 모양(게이트웨이가 OK/ERROR-09/ERROR-01 을 의도대로 읽는지)과 멱등 판정 로직은 순수 함수로 떼어 스펙을 붙인다.

## 7. #1249 와의 경계

- 기준은 **지금의 develop** 이다. #1249 브랜치는 core 출고 데이터도 바꾼다(`delivery_profiles.holder_id`·`waybills.sender_snapshot` 추가, 보내는 분을 배송 프로필 값으로 채우고 빈 칸만 `HANJIN_SENDER_*` 로). 이 작업은 그 변경을 전제하지 않는다.
- §5.2-4 의 배송 프로필 준비와 §5.1 의 발송인 자리표시자는 develop 기준으로 만든다. #1249 가 rebase 할 때 시드의 배송 프로필에 발송인 값을 채울지는 #1249 쪽이 판단한다.

## 8. 열어 둔 것

없음. 결정은 위에 «사용자 결정» / «내 결정»으로 표시했다.

검토(2026-11-18)에서 나온 질문 셋은 이렇게 닫았다:

- 합배송 묶음 → 주문마다 주소를 바꾼다(§5.3-4).
- #1249 스텁·비교 도구와의 관계 → 스텁은 이쪽으로 흡수하고, 비교는 #1249 도구를 쓴다(§5.1, §5.5, §7).
- ② 모드 → 양쪽 다 통과해야 한다(§5.5-B).
