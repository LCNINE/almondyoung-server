# 쿠폰 개통 리허설 2차 — 실행 지침

> **이 문서는 별도 세션에서 사람이 손으로 돌리는 절차다.** 대화 맥락 없이 이것만 읽고 실행할 수 있게 썼다.
> 자동 테스트가 아니다 — 여기 있는 항목은 **전부 자동 테스트가 못 덮는 것들**만 골랐다.

**목적:** `A5` 자동발급 개통 직전의 마지막 관문. 이 리허설을 통과해야 라이브 플래그를 켠다.

**SoT:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`
**1차 기록:** #488 「리허설 1차 실행 기록」 절 (2026-08-30, 11항목 ✅10/❌1)
**환경 절차 정본:** `docs/local-dev.md` 「전체 스택 로컬 구동」 — 이 문서는 거기에 **channel-adapter 를 더한다**

---

## 0. 왜 2차가 필요한가 — 한 문단

1차(2026-08-30) 이후에 **P4+P5**(발급 인스턴스 + 유효기간 두 축, PR #771)와 **P7**(발급 시점 룰 fail-closed, PR #772)이 들어왔고, **P10-A/P10-B**(닫힌 기본값, 정률 캡)는 배포됐지만 **라이브에서 한 번도 실행된 적이 없다**(쿠폰 실사용 0건). 즉 지금 라이브에 있는 쿠폰 코드의 상당 부분은 **코드 읽기와 통합 테스트로만** 검증돼 있다. 그리고 자동발급(`A5`)은 플래그가 꺼져 있어 **트리거 경로 전체가 한 번도 안 돌았다.**

1차가 이미 닫은 것(`1-4`·`4-1`·`7-6`·`N2`·`N3`)은 여기서 반복하지 않는다. **이 문서는 1차 이후에 생긴 것 + 1차가 못 덮은 것만 다룬다.**

---

## 1. 시작 전 — 어느 코드로 도는가

```bash
cd <레포>
git fetch origin
# P7 이 develop 에 머지됐으면:
git checkout develop && git pull
# 아직 PR #772 가 열려 있으면:
git checkout feat/coupon-auto-issue-activation && git pull
git log --oneline -1     # 여기서 본 해시를 결과 기록에 적는다
```

**확인:** 아래 파일이 존재해야 한다. 없으면 P7 이 안 들어온 브랜치다.
```bash
ls apps/medusa/src/modules/promotion-meta/issuance-rules.ts
ls apps/channel-adapter/src/observability/coupon-issue.metrics.ts
```

**사전 지식 3줄:**
- **쿠폰 유효기간은 두 축이다.** 정책 축 = `promotion_meta.starts_at`/`ends_at`/`validity_days`(발급 가능 기간) · 인스턴스 축 = **발급 링크 행의 `expires_at`**(사용 가능 기간, 발급 시점에 계산해 박는다). **캠페인 날짜는 안 쓴다.**
- **발급 시점 룰 평가는 fail-closed 다.** 분류표(`issuance-rules.ts`) 밖의 룰을 가진 쿠폰은 **발급되지 않는다**. 어드민 `force` 발급만 그 게이트를 넘는다.
- **`promotion_meta` 행이 없는 프로모션은 아무도 못 쓴다**(P10-A 의 닫힌 기본값). 네이티브 `/app/promotions` 로 만든 쿠폰이 여기 해당한다.

---

## 2. 환경 구축

### 2-1. 기본 스택 — `docs/local-dev.md` 「전체 스택 로컬 구동」 §1~4 를 그대로 따른다

요약(상세는 그 문서가 정본):

| 앱 | 포트 | 템플릿 |
|---|---|---|
| user-service | 3000 | `env-templates/.env.user-service.local.example` → `apps/user-service/.env` |
| auth-web | 8001 | `.env.auth-web.local.example` → `web/auth-web/.env.local` |
| Medusa | 9000 | `.env.medusa.local.example` → `apps/medusa/.env` |
| wallet | 5001 | `.env.wallet.local.example` → `apps/wallet/.env` |
| admin-web | 8002 | `.env.admin-web.local.example` → `apps/admin-web/.env.local` |
| storefront | 8000 | `.env.storefront.local.example` → `web/almondyoung-storefront/.env.local` |

```bash
docker compose up -d                 # postgres·redis·kafka
npm run db:migrate:local
(cd apps/medusa && npx medusa db:migrate --execute-safe-links)
./scripts/local/gen-oauth-keys.sh >> apps/user-service/.env   # 템플릿의 자리표시자 두 줄은 지운다
npm run db:seed:user-service:local
(cd apps/medusa && npx medusa exec ./src/scripts/seed.ts && npx medusa exec ./src/scripts/seed-shipping.ts)
(cd apps/medusa && npx medusa user -e <관리자메일> -p <비밀번호>)
```

일치해야 하는 값 셋(어긋나면 조용히 401/400): `OAUTH_INTERNAL_SECRET`(user-service↔auth-web) · `OIDC_CLIENT_SECRET`(medusa↔storefront↔`oauth_clients` 시드) · `WALLET_API_KEY`(medusa↔wallet).

### 2-2. 🔴 이번에만 추가되는 것 ①: Medusa 에 자동발급 플래그를 켠다

`apps/medusa/.env` 에 **직접 추가한다** — 템플릿에 없다:

```bash
echo 'COUPON_AUTO_ISSUE_ENABLED=true' >> apps/medusa/.env
```

**이게 없으면 `POST /admin/customers/:id/issue-coupons` 가 즉시 `{issued:[],skipped:[]}` 로 반환하고 끝난다.** 라우트 첫 줄의 킬스위치다. 1차가 자동발급을 못 덮은 이유가 정확히 이것이다.

### 2-3. 🔴 이번에만 추가되는 것 ②: channel-adapter

**1차 환경에는 없었다.** `7-2`(빠른 레인)·`7-4`(메트릭)는 channel-adapter 안에 있으므로 이걸 안 띄우면 그 둘이 미검증으로 남는다.

`apps/channel-adapter/.env` 를 새로 만든다. `env-templates/.env.channel-adapter.example` 은 Railway 시절 것이라 그대로는 안 되고, **`env.validation.ts` 가 required 로 요구하는 것들을 채워야 부팅한다** — 쿠폰과 무관한 채널 자격증명도 required 라 **더미로 채운다**:

```bash
cat > apps/channel-adapter/.env <<'EOF'
DATABASE_URL=postgres://postgres:postgres@localhost:5432/channel_adapter
PORT=3010
NODE_ENV=development

# Kafka — user-service 가 발행한 users.events.v1 을 여기서 받는다
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID_PREFIX=channel-adapter
KAFKA_GROUP_ID=channel-adapter-rehearsal

# Medusa — 발급 API 를 부른다. MEDUSA_API_KEY 는 admin-web 이 쓰는 것과 같은 secret API 키다
MEDUSA_API_URL=http://localhost:9000
MEDUSA_API_KEY=<admin-web 과 같은 값>

# 쿠폰과 무관하지만 env 검증이 required 로 요구한다 (부팅만 되면 된다)
NAVER_API_ENDPOINT=http://localhost:1
NAVER_CLIENT_ID=dummy
NAVER_CLIENT_SECRET=dummy
COUPANG_ACCESS_KEY=dummy
COUPANG_SECRET_KEY=dummy
COUPANG_VENDOR_ID=dummy

# 인증 가드용 (로컬 IdP)
OIDC_ISSUER_URL=http://localhost:3000
EOF
```

기동:
```bash
npm run start:channel-adapter:dev      # :3010, 메트릭은 :13010/metrics
```

**부팅 후 무해한 에러 둘 — 쫓지 말 것:**
- `OrderPollerOrchestrator` 가 5분마다 core `/internal/channels/active-sites` 를 부르는데 core 를 안 띄웠으므로 실패한다. 게이트는 **fail-closed** 라 그 주기의 수집을 건너뛸 뿐이고 (#654), 쿠폰 경로와 무관하다.
- Naver/Coupang 어댑터가 더미 자격증명으로 실패하는 로그. 마찬가지로 무관하다.

### 2-4. 기동 순서

```bash
npx dotenv -e apps/user-service/.env -- nest start user-service   # :3000
(cd web/auth-web && npm run dev)                                  # :8001
(cd apps/medusa && npx medusa develop)                            # :9000
npx dotenv -e apps/wallet/.env -- nest start wallet               # :5001
npm run start:channel-adapter:dev                                 # :3010  ← 이번 추가분
(cd apps/admin-web && npm run dev)                                # :8002
(cd web/almondyoung-storefront && npm run dev)                    # :8000
```

`http://localhost:8000/kr/login` 에서 로그인이 되면 배선이 맞은 것이다.

### 2-5. 1차에서 실제로 막혔던 지점 (같은 데서 또 막히지 말 것)

`docs/local-dev.md` 「부팅 중 실제로 걸린 것들」에 전문이 있다. 요약:
- **user-service 는 `KAFKA_BROKERS` 없이 못 뜬다**(경고만 찍고 죽는다). 선택 아님
- user-service 포트 변수는 `PORT` 다(`USER_SERVICE_PORT` 는 아무도 안 읽는다)
- 회원가입 `birthday` 는 ISO(`1990-01-01`). DTO 예시값 `19900101` 은 500 이 난다
- storefront `.env.template` 을 그대로 쓰면 라이브를 본다 — `USE_RAILWAY_BACKEND=false`
- `AUTH_WEB_URL` 을 세우면 Medusa customer 인증이 `user-service-sso` 하나로 좁혀진다
- `PARENT_COOKIE_DOMAIN` 은 비우고 `PARENT_COOKIE_SECURE=false`, auth-web 도 `COOKIE_SECURE=false`

---

## 3. 체크리스트

각 항목은 **결과를 ✅/❌/⛔(미실행)** 로 적고, ❌ 는 증상·요청/응답·해당 파일 줄까지 남긴다.

| # | 항목 | 무엇을 지키는가 | 자동 테스트가 왜 못 덮나 |
|---|---|---|---|
| **R1** | 쿠폰 6종 생성 → 카트 적용 → 할인액 대조 | 폼→엔진 페이로드 | 축(`target_type`×`discountType`) 조합은 실 폼에서만 |
| **R2** | 배송비 쿠폰 생성 | `F1` 회귀 | 1차의 유일한 ❌ 였다 |
| **R3** | **배송비 쿠폰 + 정률 캡** | `A4`/P10-B | **배송옵션 픽스처가 저장소에 없다** |
| **R4** | 캡이 표시되는가 (프리뷰·이벤트·체크아웃) | P10-B 표시 9곳 | `.tsx` 는 렌더 테스트가 없다 |
| **R5** | `validity_days` → 링크행 `expires_at` | P4+P5 인스턴스 축 | 값의 «의미»는 화면에서만 보인다 |
| **R6** | 정책 변경이 **소급 만료시키지 않는가** | P4+P5 핵심 결정 | 시간축 시나리오 |
| **R7** | 발급창 밖 발급 거부 + **기존 보유분은 계속 사용 가능** | 결정 1의 존재 이유 | 엔진 캠페인 필터 우회의 실증 |
| **R8** | `detach-coupon-campaigns.ts` dry-run → 반영 | 배포 후 필수 스크립트 | **라이브에서 처음 돌면 늦다** |
| **R9** | 분류표 밖 룰 → 발급 거부 · 새 문구 · `force` 우회 | P7 `1-5` | 어드민 다이얼로그 문구는 `.tsx` |
| **R10** | 카트 문맥 룰(`subtotal`) 쿠폰은 발급됨 | P7 대조군 | — |
| **R11** | **자동발급 end-to-end (channel-adapter 경유)** | `A5` 전체 | 라이브·로컬 통틀어 **실행 0회** |
| **R12** | `/metrics` 에 발급 카운터가 뜨는가 | `7-4` | 스크레이프는 앱 밖 |
| **R13** | 빠른 레인이 실패 행을 **1회만** 되살리는가 | `7-2` | 크론 실발화 |
| **R14** | 전액 환불 후 쿠폰 상태 | `A2`(미해결 확인) | — |

---

### R1. 쿠폰 6종 — 축으로 짠다

🔴 **1차의 교훈: 조합이 아니라 축이다.** 1차 R7 은 페이로드 3발을 쐈지만 셋 다 `target_type: order` 라 `allocation` 축을 지나가지 않았고, 배송비 결함은 R7 이 아니라 「4종을 다 만들어 본다」가 잡았다.

admin-web(`localhost:8002`) 쿠폰 생성 화면에서 **`target_type` 3값 × `discountType` 2값 = 6개를 전부** 만든다.

| # | 적용 대상 | 할인 방식 | 기대 |
|---|---|---|---|
| 1 | 주문 전체(`order`) | 정액 | 생성 200 |
| 2 | 주문 전체 | 정률 | 생성 200 |
| 3 | 특정 상품(`items`) | 정액 | 생성 200 |
| 4 | 특정 상품 | 정률 | 생성 200 |
| 5 | 배송비(`shipping_methods`) | 정액 | 생성 200 ← **R2** |
| 6 | 배송비 | 정률 | 생성 200 ← **R2**·**R3** |

각각 스토어프론트 카트에 적용해 **할인액이 의도와 맞는지** 눈으로 대조한다.

### R2. 배송비 쿠폰 생성 (F1 회귀)

1차에서 **100% 400** 이었다:
```
application_method.allocation should be either 'across OR each OR once'
when application_method.target_type is either 'shipping_methods OR items'
```
원인은 `build-create-promotion-payload.ts` 가 `allocation` 을 `items` 에만 붙인 것. F1 이 고쳤다고 기록돼 있으니 **여기서 그 사실을 확인**한다. 다시 400 이면 그 파일부터 본다.

### R3. 🔴 배송비 쿠폰 + 정률 캡 — 이번 리허설의 최우선 항목

**P10-B 가 자동 테스트로 못 덮은 유일한 경로다**(배송옵션 픽스처가 저장소 어디에도 없다).

1. 「배송비 · 정률 50% · 최대 할인금액 2,000원」 쿠폰을 만든다
2. 배송비가 5,000원인 카트를 만든다 (시드된 배송옵션 사용)
3. 적용 → **할인이 2,500원이 아니라 2,000원이어야 한다**
4. 주문 완료 → **결제 금액도 캡된 금액과 일치**해야 한다

🔴 **adjustment 되쓰기가 `upsert` 인지 `set` 인지가 여기서 드러난다.** `set` 계열이면 캡 대상이 아닌 다른 adjustment 가 조용히 사라진다 — 다른 할인을 하나 더 얹은 카트로도 한 번 확인할 것.

### R4. 캡 표시 3곳

같은 쿠폰(R3)으로 **「10%」만 보이고 캡이 안 보이는 화면이 없는지** 본다. P10-B 가 9곳을 고쳤고, 그중 고객이 *쿠폰을 받는 순간*의 화면 셋이 특히 중요하다:

- `/kr/coupons/claim?code=<코드>` (클레임 프리뷰)
- 이벤트 페이지 `/kr/events/<slug>` (이벤트가 있으면)
- 체크아웃 할인 섹션 — **드롭다운 선택**과 **코드 직접 입력** 두 경로 모두

### R5. `validity_days` → 링크 행 `expires_at`

1. 「유효기간 30일」 쿠폰을 `claimable` 로 만든다
2. 스토어프론트에서 발급받는다
3. **DB 확인** — 링크 행에 실값이 박혀 있어야 한다:
   ```sql
   -- medusa DB
   SELECT customer_id, promotion_id, expires_at, issued_via, used_at, order_id
     FROM customer_customer_promotion_promotion   -- 링크 테이블 (2026-09-01 로컬 DB 실측)
    ORDER BY created_at DESC LIMIT 5;
   ```
   `expires_at` ≈ **발급 시각 + 30일**, `issued_via='customer_claim'`, `used_at`/`order_id` 는 `null`
4. 마이페이지 쿠폰 목록에 그 만료일이 보이는가

### R6. 🔴 정책을 바꿔도 이미 발급된 것은 소급 만료되지 않는다

**이게 P4+P5 의 존재 이유다.** 정책에서 매번 도출했다면 「30일→7일」이 이미 발급된 쿠폰을 소급 만료시킨다.

1. R5 의 쿠폰을 다른 고객이 하나 더 발급받는다
2. 쿠폰 정책의 유효기간을 **7일로 바꾼다**(현재 수정 화면이 없으면 `promotion_meta.validity_days` 를 SQL 로 바꾼다 — 그것도 유효한 검사다)
3. **먼저 발급된 두 장의 `expires_at` 이 그대로 30일 뒤인지** 확인
4. 이후 새로 발급되는 것만 7일이어야 한다

### R7. 🔴 발급창은 닫혀도 보유분은 산다

**엔진의 `computeActions` 가 캠페인 창 지난 프로모션을 할인 계산에서 제외**하기 때문에 캠페인 날짜를 안 쓰기로 한 것이다. 그 결정이 실제로 통하는지 본다.

1. `claimable` 쿠폰을 만들고 **발급 창(`ends_at`)을 내일**로 둔다. 유효기간은 30일
2. 고객 A 가 오늘 발급받는다
3. `promotion_meta.ends_at` 을 **어제**로 바꾼다(창을 닫는다)
4. **기대**:
   - 고객 B 의 발급 시도 → **거부**(「발급 기간이 끝난 쿠폰입니다」)
   - 고객 A 의 보유 쿠폰 → **여전히 마이페이지에 있고, 카트에 적용되고, 할인이 계산되고, 주문이 완료된다**
5. 🔴 **여기서 할인이 0원이 되면 결정 1이 깨진 것이다** — 캠페인 창이 어디선가 아직 쓰이고 있다는 뜻이므로 즉시 기록하고 멈춘다

### R8. `detach-coupon-campaigns.ts` — 라이브에서 처음 돌리지 않기 위해

**이 스크립트는 선택이 아니다.** 안 돌리면 이 작업 이전에 발급된 링크 전량이 `expires_at = null`(무기한)로 영영 남는다. 라이브에서 처음 실행하기 전에 로컬에서 한 번 통과시킨다.

```bash
cd apps/medusa
# 1) dry-run (기본값)
npx medusa exec ./src/scripts/detach-coupon-campaigns.ts
# 2) 출력을 육안으로 확인한 뒤 반영
DETACH_CAMPAIGNS_DRY_RUN=false DETACH_CAMPAIGNS_CONFIRM=detach-coupon-campaigns \
  npx medusa exec ./src/scripts/detach-coupon-campaigns.ts
```

dry-run 출력에 **대상 건수와 어떤 프로모션이 걸리는지**가 나온다. 그 숫자를 결과에 적는다 — 라이브에서 같은 스크립트를 돌릴 때 비교 기준이 된다.

### R9. 🔴 분류표 밖 룰 = 발급 거부 (P7 `1-5`)

우리 어드민 폼은 분류표 밖 룰을 만들지 못하므로 **API 로 직접 만든다**:

```bash
TOK=$(curl -s -X POST http://localhost:9000/auth/user/emailpass -H 'content-type: application/json' \
  -d '{"email":"<관리자메일>","password":"<비밀번호>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 고객이 «속하지 않은» 그룹 id 를 하나 준비해 <GROUP_ID> 에 넣는다
curl -s -X POST http://localhost:9000/admin/promotions -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' -d '{
    "code":"R9UNSUP","type":"standard","is_automatic":false,"status":"active",
    "application_method":{"type":"percentage","value":10,"target_type":"order","currency_code":"krw"},
    "rules":[{"attribute":"customer.groups.id","operator":"ne","values":["<GROUP_ID>"]}],
    "additional_data":{"visibility":"claimable","auto_issue_trigger":"customer_registered"}
  }'
```

`operator: "ne"` 를 쓰는 이유: **속성은 엔진이 아는 것이라 생성이 반드시 되고, operator 는 우리 분류표 밖이라 발급이 반드시 거부된다.** 두 조건을 동시에 만족하는 유일한 조합이다.

**기대:**
1. **자동발급** — `POST /admin/customers/<고객>/issue-coupons {"trigger":"customer_registered"}` → `skipped` 에 `{promotion_id, reason:"unsupported_rule"}`. Medusa 로그에 `[coupon] 자동발급 skip — 발급 시점에 평가할 수 없는 룰` warn
2. **어드민 수동발급** — admin-web 쿠폰 상세 → 발급 다이얼로그 → 고객 이메일 입력 → 발급.
   화면에 **「이 쿠폰의 발급 조건은 아직 발급 시점에 판정할 수 없습니다. 개발팀 확인이 필요합니다(강제 발급은 가능).」** 이 떠야 한다.
   🔴 「대상 고객 그룹이 아닙니다」가 뜨면 라벨 배선이 틀린 것이다 — 두 문구는 반드시 달라야 한다(어드민이 «고객을 그룹에 넣으면 되겠네»로 오해하면 안 된다)
3. **`force` 발급** — 같은 다이얼로그의 강제 발급 → **발급된다**(탈출구가 살아 있는지)
4. **스토어** — 그 쿠폰은 마이페이지 claimable 목록에 **안 뜨고**, 클레임 프리뷰(`/kr/coupons/claim?code=R9UNSUP`)는 **「대상 고객만」** 으로 거부

### R10. 카트 문맥 룰은 무시하고 발급 (대조군)

R9 와 같은 방법으로 `{"attribute":"subtotal","operator":"gte","values":["30000"]}` 룰 쿠폰을 만든다.
**기대: 자동발급으로 정상 발급된다.** (최소주문금액은 카트가 생겨야 판정되므로 발급 시점에 막으면 안 된다.)
그리고 그 쿠폰은 **3만원 미만 카트에서는 할인 0**, 3만원 이상에서 할인 적용 — 엔진이 카트에서 제대로 평가하는지까지 본다.

### R11. 🔴 자동발급 end-to-end — 이 리허설의 본체

**경로:** storefront 회원가입 → 이메일 인증 → user-service 가 `UserEmailVerified` 발행 → Kafka `users.events.v1` → channel-adapter `UserEventConsumer` → `inbox_events` → `InboxWorkerService` → `findCustomerByAlmondUserId` → `POST /admin/customers/:id/issue-coupons` → 링크 생성

🔴 **순서가 중요하다.** `findCustomerByAlmondUserId` 는 **Medusa customer 가 이미 있어야** 성공한다. Medusa customer 는 **스토어프론트 첫 로그인 때** 생긴다. 없으면 `SlowRetryInboxError` 로 최대 1시간 백오프에 들어가 리허설이 멈춘다.

**절차:**
1. `auto_issue_trigger = 회원가입`(`customer_registered`) 인 `assigned_only` 쿠폰을 하나 만든다
2. 새 계정으로 회원가입한다 (`birthday` 는 **ISO** `1990-01-01`)
3. **먼저 스토어프론트에 로그인**해 Medusa customer 를 만든다
4. 이메일 인증을 발화시킨다. 로컬엔 메일이 안 오므로 토큰을 DB 에서 꺼낸다:
   ```bash
   docker compose exec -T postgres psql -U postgres -d user_service -c \
     "select value, type, created_at from tokens where user_id='<userId>' order by created_at desc limit 3;"
   curl -i "http://localhost:3000/auth/verify-email?token=<value>"
   ```
5. **확인 순서대로 좇는다** — 어디서 끊겼는지가 곧 진단이다:
   ```sql
   -- channel_adapter DB: 이벤트가 들어왔는가
   SELECT id, event_type, status, attempts, error_message, created_at
     FROM inbox_events WHERE event_type='UserEmailVerified' ORDER BY created_at DESC LIMIT 5;
   ```
   - `status='published'` → 성공
   - `status='pending'` + `attempts>0` → 아직 재시도 중(Medusa customer 없음이 대표 원인)
   - `status='failed'` → `error_message` 를 본다 (그리고 **R13 의 재료가 된다 — 지우지 말 것**)
6. Medusa 로그에 `Auto-issued N coupon(s) to customer ...` 가 찍히고, **마이페이지 쿠폰 목록에 그 쿠폰이 있어야 한다**

**`membership_activated` 트리거는 이 리허설에서 end-to-end 로 돌리지 않는다**(membership 앱 + Firebase 가 필요). 대신 `POST /admin/customers/:id/issue-coupons {"trigger":"membership_activated"}` 를 직접 쳐서 **Medusa 쪽 절반만** 확인하고, 그 사실을 결과에 명시한다.

### R12. 메트릭

```bash
curl -s http://localhost:13010/metrics | grep coupon_
```

**기대** (R11 을 돌린 뒤):
- `coupon_auto_issue_total{trigger="customer_registered",outcome="issued"}` ≥ 1
- R9 를 자동발급으로 돌렸다면 `outcome="unsupported_rule"` 도 보인다
- `coupon_issue_inbox_failed_rows{event_type="..."}` 이 두 타입 다 존재(값 0 이어도 시리즈는 있어야 한다 — 게이지는 15분 크론이 처음 돌 때 세워진다)

⚠️ **자동발급이 아무 일도 안 했으면 카운터 시리즈는 «존재하지 않는다».** 그게 정상이다 — Grafana 에서 `No Data → Alerting` 으로 매핑하면 안 되는 이유가 이것이다.

### R13. 🔴 빠른 레인이 «1회만» 되살리는가

`inbox_events` 에 실패 행을 심고 15분 크론을 기다린다(또는 앱 재시작 후 첫 발화를 본다).

```sql
-- channel_adapter DB: 실패 행을 만든다 (R11 에서 실제 failed 가 생겼으면 그걸 쓴다)
UPDATE inbox_events SET status='failed', failed_at=now(), attempts=5, error_message='rehearsal'
 WHERE id='<row id>';
```

**기대:**
1. 15분 안에 `status` 가 `pending` 으로 돌아오고 `attempts=0`, `metadata` 에 **`coupon_fast_reset`** 키가 생긴다
2. 같은 행을 **다시 `failed` 로 만들면** — 두 번째 회차에는 **되살아나지 않는다**(마커가 있으므로). 03:00 크론이 백스톱이다
3. 로그: `쿠폰 발급 실패 N건을 즉시 재시도 큐로 되돌렸다 (빠른 레인)`

```sql
SELECT id, status, attempts, metadata->'coupon_fast_reset' AS marker FROM inbox_events WHERE id='<row id>';
```

### R14. 전액 환불 후 쿠폰 상태 (`A2` — 고쳐지지 않았음을 확인)

1차에서 실측 확정됐다: **1인당 한도 2/2 를 쓴 뒤 두 주문 모두 취소·전액 환불해도 `campaign_budget_usage` 가 2 그대로**라 쿠폰이 영구히 사라진다. 아직 안 고쳤으므로 **「여전히 그렇다」를 확인**하고 넘어간다. 달라졌다면 그것이 뉴스다.

---

## 4. 결과를 어디에 남기나

1. **#488 에 「리허설 2차 실행 기록」 코멘트** — 1차와 같은 표 모양(항목 / 결과 / 비고), 맨 위에 **브랜치·커밋 해시·실행 날짜**
2. **마스터플랜** `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md` 진행 상황의 `- [ ] 리허설 2차 → A5 개통` 갱신
3. ❌ 가 나오면 **이슈로 뽑거나 #488 항목으로 편입**한다. ❌ 를 남긴 채 개통하지 않는다
4. ⛔(미실행)를 **✅ 로 반올림하지 않는다.** 1차가 「11항목 전부 실행, ⛔ 0건」을 지킨 것이 그 기록을 믿을 수 있게 만든 이유다

---

## 5. 통과 뒤 — A5 개통 (리허설과 별개 작업)

1. **라이브에서 재실측**:
   ```sql
   SELECT count(*) FROM promotion_meta
    WHERE auto_issue_trigger IS NOT NULL AND deleted_at IS NULL;   -- 기대: 0
   ```
   **0 이 아니면 멈춘다.** 플래그를 켜는 순간 그 규칙이 발화한다.
2. **P4+P5 배포 후 작업** — 라이브에서 `detach-coupon-campaigns.ts` dry-run → 육안 확인 → 반영 (R8 에서 연습한 그것)
3. **플립** — `deployments/lcnine/services/infra/services.ts` 의 Medusa `environment` 에 한 줄:
   ```ts
   COUPON_AUTO_ISSUE_ENABLED: 'true',
   ```
4. `sst deploy --stage live`
5. **개통 확인** — 발급이 아니라 시리즈의 «존재»로 본다:
   ```promql
   sum by (trigger, outcome) (increase(coupon_auto_issue_total[1h]))
   ```
6. **되돌리기** — 그 한 줄을 지우고 재배포. 이미 발급된 쿠폰은 남는다(회수는 어드민에서 건별)

---

## 6. 이 리허설이 다루지 않는 것 (미리 적어 둔다)

- **`membership_activated` end-to-end** — membership 앱 + Firebase 필요. Medusa 쪽 절반만 확인한다(R11)
- **실 PG 결제** — 포인트 전액결제로 우회한다(`docs/local-dev.md` §5). NicePay 결제창은 미실행
- **CS 화면(`A1`)** — 백엔드만 있고 admin-web 호출부가 0건(P8 범위)
- **`7-3`(발급 계약이 3서비스에 샌다)** — 별도 트랙(2026-08-31 결정 5)
- **다중 인스턴스 동시성** — 로컬은 단일 프로세스라 크론 중복 발화(리더 선출 부재)를 재현하지 못한다
