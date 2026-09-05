# 쿠폰 개통 리허설 3차 — 실행 지침

> **이 문서는 별도 세션에서 돌리는 절차다.** 대화 맥락 없이 이것만 읽고 실행할 수 있게 썼다.
> 자동 테스트가 아니다 — 여기 있는 항목은 **전부 자동 테스트가 못 덮는 것들**만 골랐다.
>
> **3차는 목적이 둘이다.** ① `A5` 개통 관문(검증) ② **리테일팀 가이드용 스크린샷 촬영**(자료).
> 둘은 요구가 다르다 — §5 가 그 경계를 정한다. 섞으면 둘 다 못 쓴다.
>
> **▶ 세션을 시작할 프롬프트는 §9 에 복붙용으로 있다.**

**SoT:** 이슈 [#488](https://github.com/LCNINE/almondyoung-server/issues/488) · [#775](https://github.com/LCNINE/almondyoung-server/issues/775) · 로드맵 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`
**2차 기록:** #488 「리허설 2차 실행 기록」 절 (2026-09-01) — **R11 만 ❌**, 나머지 전부 ✅ (R4 는 이벤트 0건이라 5곳 중 4곳만)
**환경 절차 정본:** `docs/local-dev.md` 「전체 스택 로컬 구동」 + **`docs/superpowers/plans/2026-09-01-coupon-rehearsal-2.md` §2**
 — 🔴 **이 문서는 2차 §2 를 복제하지 않는다.** 환경은 거기서 읽고, 여기 §2 는 **차이만** 적는다.

---

## 0. 왜 3차인가 — 재실행 범위는 diff 가 정했다

2차(2026-09-01) 이후 두 덩어리가 들어왔고 **둘 다 라이브 실행 0회**다.

1. **#775 / PR #787** (`6e315d1aa`, 배포 완료) — `customer_registered` 트리거를 도달 불가한
   user-service `UserEmailVerified` 에서 **Medusa `customer.created` subscriber** 로 옮겼다.
   2차의 **유일한 ❌ 였던 R11** 이 이것 때문이었다.
2. **PR-2 · PR-3** (#781 · #784) — 쿠폰 «소모» 를 미문서 훅 `orderCreated` 에서 `validate` 훅으로
   옮기고, **소모가 곧 검사**가 되게 하고, 소모의 키를 주문이 아니라 **카트**로 바꿨다.
   취소 복원 구독자와 스위퍼가 함께 생겼다. **런타임 검증 0.**

**「R11 하나만 다시 돌리면 된다」가 아니다.** #787 의 diff 가 channel-adapter 를 넓게 건드렸다:

| 파일 | 변경 | 3차에 미치는 영향 |
|---|---|---|
| `channel-adapter/.../coupon-issue-reconciliation.service.ts` | **94줄** | **R13(빠른 레인) 회귀 위험** |
| `channel-adapter/.../inbox-worker.service.ts` | 21줄 | R11b 경로 |
| `channel-adapter/.../internal-membership.controller.ts` | 7줄 | R11b 경로 |
| `channel-adapter/.../user-event.consumer.ts` | −57줄 | Cafe24 두 핸들러 생존 확인 필요 |
| `medusa/.../metrics-server.ts` · `instrumentation.ts` | 신규 | **R12 의 측정점이 2곳으로** |

그래서 3차 = **재실행 4(R11·R11b·R12·R13) + 신규 #775 3(N1~N3) + 신규 소모 5(C1~C5) = 12항목.**

2차가 이미 닫은 R1~R10 · R14 는 **반복하지 않는다.** 단 그 쿠폰들은 §3 대본이 다시 만든다 —
검증 때문이 아니라 **스크린샷 때문**이다.

---

## 1. 시작 전 — 어느 코드로 도는가

```bash
cd <레포>
git fetch origin
git checkout develop && git pull
git log --oneline -1     # 여기서 본 해시를 결과 기록에 적는다
```

**#787 은 이미 라이브에 배포됐다.** 즉 로컬 `develop` 은 라이브와 같은 코드다.
그래도 **리허설은 로컬에서 돈다** — 라이브에서 신규 가입·주문·취소를 만들 수 없기 때문이다.

**확인:** 아래 파일이 전부 있어야 한다. 하나라도 없으면 develop 이 아니거나 pull 이 덜 된 것이다.
```bash
ls apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts
ls apps/medusa/src/observability/metrics-server.ts
ls apps/medusa/src/workflows/hooks/cart/consume-coupon-grants.ts
ls apps/medusa/src/subscribers/coupon-grant-restore.ts
ls apps/medusa/src/jobs/restore-stuck-coupon-consumptions.ts
```

### 사전 지식 6줄 — 이걸 모르면 결과를 오독한다

1. **쿠폰 유효기간은 두 축이다.** 정책 축 = `promotion_meta.starts_at`/`ends_at`/`validity_days`(**발급 가능** 기간) ·
   인스턴스 축 = **`coupon_grant.expires_at`**(**사용 가능** 기간, 발급 시점에 계산해 박는다). **캠페인 날짜는 안 쓴다.**
2. **발급 시점 룰 평가는 fail-closed 다.** 분류표(`issuance-rules.ts`) 밖의 룰을 가진 쿠폰은 발급되지 않는다.
   어드민 `force` 발급만 그 게이트를 넘는다.
3. **`promotion_meta` 행이 없는 프로모션은 아무도 못 쓴다**(P10-A 닫힌 기본값). 네이티브 `/app/promotions` 로 만든 쿠폰이 여기 해당한다.
4. 🔴 **소모가 곧 검사다.** 옛 구조는 훅이 장을 «읽어 검사» 하고 열 스텝 뒤에 «썼다». 이제
   `consumeOneUsableGrantForCart` 의 결과가 판정이다 — `none` 이고 장이 사용을 지배하면 **주문이 거절된다.**
5. 🔴 **소모의 키는 주문이 아니라 카트다.** 소모는 `completeCartWorkflow.validate` 훅에서 일어나고 그 시점엔 주문이 없다.
   **`coupon_grant.order_id` 컬럼은 존재하지 않는다** — PR-3 이 읽기·쓰기를 끊고 **#785 contract 가 컬럼을 지웠다**
   (`promotion_meta.issued_count` 도 함께). 2026-09-05 로컬 DB 실측으로 확인.
   주문 ↔ 카트는 Medusa 의 **`order_cart` 링크**가 잇는다. 옛 문서·플랜에서 `order_id` 를 보면 그건 **지워지기 전 상태**다.
6. 🔴 **`customer_registered` 는 이제 Kafka·channel-adapter 를 지나지 않는다.** Medusa 안에서 시작해 Medusa 안에서 끝난다.
   `membership_activated` 만 여전히 channel-adapter 를 지난다. **두 트리거의 경로가 다르다.**

---

## 2. 환경 — 2차와 무엇이 다른가

**기본 구축은 `2026-09-01-coupon-rehearsal-2.md` §2 를 그대로 따른다** (앱 8개, 포트, env 템플릿, 기동 순서,
일치해야 하는 값 셋). 아래는 **3차에서만 다른 것**이다.

| # | 항목 | 2차 | 3차 |
|---|---|---|---|
| ① | `customer_registered` 경로 | user-service → Kafka → channel-adapter → Medusa 라우트 | **Medusa 내부만** (`customer.created` subscriber) |
| ② | 메트릭 측정점 | channel-adapter `:13010/metrics` | **+ Medusa `:19000/metrics`** (신규) |
| ③ | channel-adapter | R11·R11b 둘 다 여기를 지남 | **R11b·R13 만.** 그래도 **띄워야 한다**(회귀 검증 대상) |
| ④ | 스위퍼 | 없었음 | `COUPON_STUCK_MIN_AGE_MINUTES` 조정 필요 (C4) |

### 2-0. 🔴 **먼저 «떠 있는 것»을 믿지 마라** — 2026-09-05 실측으로 추가된 절

2차 환경이 **그대로 살아 있을 수 있다.** 포트 8개가 다 열려 있고 `.env` 가 다 있어도 그것은
**「2차 당시 코드가 4일째 돌고 있다」는 뜻일 수 있다.** 실제로 3차 착수 시 그랬다:
프로세스 8개가 전부 `2026-09-01 06:47` 기동이었고, **Medusa DB 의 마지막 마이그레이션은 `Migration20260831110000`**,
**`coupon_grant` 테이블 자체가 없었다.** 그 상태로 R11 을 돌렸으면 판정 SQL 이 죽고 C1~C5 는 전부 성립하지 않는다.

**기동 전에 이 셋을 잰다:**

```bash
# ① 프로세스가 언제 떴나 — 오늘이 아니면 옛 코드다
ps -eo pid,lstart,args | grep -E 'nest start|next dev|medusa develop' | grep -v grep

# ② Medusa 메트릭 포트 — 닫혀 있으면 #775 이전 코드다
curl -s localhost:19000/metrics | head -3

# ③ 🔴 가장 중요 — 스키마가 최신인가
psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.coupon_grant');"          # NULL 이면 마이그 밀림
psql "$DATABASE_URL" -tAc "SELECT name FROM mikro_orm_migrations ORDER BY id DESC LIMIT 3;"
```

**하나라도 어긋나면 전면 재기동이다:**
```bash
# 포트 점유 프로세스까지 정리한다 — 부모 npm 만 죽이면 자식이 포트를 쥐고 남는다
for p in 3000 3001 3010 5001 8000 8001 8002 9000; do
  kill -TERM $(ss -ltnpH "sport = :$p" | grep -oP 'pid=\K[0-9]+' | sort -u) 2>/dev/null
done
(cd apps/medusa && npx medusa db:migrate --execute-safe-links)
# 그 뒤 2차 §2-5 기동 순서
```
⚠️ **`pkill -f` 패턴에 레포 이름(`almondyoung-server`)을 넣지 말 것** — 자기 셸의 명령줄에도 그 문자열이 있어 **자신을 죽인다**.
⚠️ **`sst tunnel --stage live` 프로세스가 함께 떠 있을 수 있다. 죽이지 말 것** — 리허설과 무관하다.

### 2-1. `apps/medusa/.env` 에 추가 — 템플릿에 없다

```bash
echo 'COUPON_AUTO_ISSUE_ENABLED=true' >> apps/medusa/.env
echo 'COUPON_STUCK_MIN_AGE_MINUTES=1' >> apps/medusa/.env
```

- 첫 줄이 없으면 **subscriber 도 라우트도 첫 줄에서 되돌아간다.** 2차가 이걸로 한 번 막혔다.
- 둘째 줄은 C4 전용이다. **기본값은 60분**이고 `0` 은 안 먹는다 —
  `Number.isFinite(raw) && raw > 0` 이라 `0` 은 기본값 60 으로 폴백한다. **`1` 이 최소다.**
  🔴 **C4 가 끝나면 이 줄을 지우거나 60 으로 되돌린다.** 1분짜리로 남겨두면 C1~C3 을 하는 중
  스위퍼 크론(`23 * * * *`)이 돌아 **정상 소모를 되돌려** 원인 모를 ❌ 를 만든다.

### 2-2. Medusa 메트릭 포트가 실제로 뜨는지 — 시작하자마자 본다

```bash
curl -s localhost:19000/metrics | head -5
```

포트는 `METRICS_PORT` 가 없으면 `PORT + 10000` 이다. 로컬 `PORT=9000` 이면 19000.
**빈 문자열 `METRICS_PORT=` 는 위험하다** — 코드가 `> 0` 으로 걸러 폴백하지만, 값을 넣을 거면 정수여야 한다.
바인딩 실패는 **프로세스를 죽이지 않고** `medusa-metrics-server` JSON 로그만 남긴다. 조용하다.

### 2-3. 2차에서 실제로 막혔던 지점 — 같은 데서 또 막히지 말 것

1. **`COUPON_AUTO_ISSUE_ENABLED` 누락** → 발급 API 가 `{issued:[],skipped:[]}` 만 반환
2. **`MEDUSA_MEMBERSHIP_GROUP_ID` 누락**(channel-adapter) → inbox 는 `published` 인데 쿠폰이 안 나감. R11b 전용
3. **스토어프론트 회원가입 UI 를 로컬에서 못 지난다** — auth-web 3/3 단계의 휴대폰 인증이
   notification 서비스로 위임되는데 로컬에 그 앱이 없어 503 이고, **코드 생성이 SMS 발송과 같은 트랜잭션**이라
   (`send-verification-code.service.ts:76-86`) DB 에 행을 심어도 UI 게이트가 안 열린다.
   → **가입은 `POST /auth/signup` 로 직접 한다.**
   🔴 **하지만 로그인은 반드시 스토어프론트 UI 로 지나야 한다** — Medusa customer 는 **첫 로그인 때** 생기고,
   그 생성이 곧 R11 의 트리거(`customer.created`)다. 2차처럼 가입만 API 로 우회하고 로그인을 건너뛰면 **R11 이 성립하지 않는다.**
4. **kafka 컨테이너가 내려가 있는 경우** — 2차에서 재기동이 필요했다. R11b·R13 이 여기 걸린다.

---

## 3. 데이터 대본 — 실물 이름으로 한 번에 만든다

🔴 **이번 리허설의 쿠폰은 처음부터 리테일팀이 봐도 되는 이름으로 만든다.** 스크린샷을 나중에 다시 찍지 않기 위해서다.
대가는 **이름에서 축이 안 읽힌다**는 것 — 그래서 이 표를 실행 내내 옆에 둔다.

| 코드 | 화면에 뜨는 이름 | 축 (검증용) | 쓰는 항목 | 스크린샷 절 |
|---|---|---|---|---|
| `AY-WELCOME` | 신규 가입 축하 쿠폰 | `assigned_only` · 정률 10% · 주문 · `validity_days=30` · **trigger=`customer_registered`** | **R11** · N1 · N2 · C1~C3 | A · C |
| `AY-MEMBER` | 멤버십 시작 감사 쿠폰 | `assigned_only` · 정액 3,000원 · 주문 · `validity_days=30` · **trigger=`membership_activated`** | **R11b** · R13 | C |
| `AY-FALL10` | 가을맞이 10% 할인 | `claimable` · 정률 10% · 주문 | 스크린샷 전용 | A · B |
| `AY-FIRST3000` | 첫 구매 3,000원 할인 | `claimable` · 정액 3,000 · 주문 | 스크린샷 전용 | A · B |
| `AY-SHIPFREE` | 배송비 무료 쿠폰 | `claimable` · 정액 · **배송비** | 스크린샷 전용 | A |
| `AY-SHIPHALF` | 배송비 반값 (최대 2,000원) | `claimable` · **정률 50% + 캡 2,000** · 배송비 | 스크린샷 전용(**캡 필드 노출**) | A · B |

**만드는 법:** 전부 **admin-web 실 폼**(`/mall/marketing/coupons` → 쿠폰 생성)으로 만든다.
API 로 만들면 **폼이 실제로 그 조합을 낼 수 있는지**를 검증하지 못하고, 스크린샷도 못 얻는다.

**폼 함정 둘 (2차 실측):**
- 할인 유형을 **「정액」으로 바꾸면 「최대 할인금액」 필드가 사라진다** — 캡은 정률 전용(의도된 동작).
  `AY-SHIPHALF` 의 캡 필드 컷(📷 A-05)은 **정률을 고른 상태에서만** 찍힌다.
- 「할인 율」 칸의 `10` 은 **placeholder 이지 기본값이 아니다.** 안 채우면 생성 버튼이 계속 disabled 다.

**계정 대본:**

| 용도 | 계정 | 만드는 법 |
|---|---|---|
| R11 · C1~C3 주 계정 | `retail-demo01@local.test` | `POST /auth/signup` → **스토어프론트 UI 로 첫 로그인** |
| N1 대조군 (어드민 생성) | 이름만 있는 고객 | **Medusa 어드민** `POST /admin/customers` (has_account=false) |
| C2 이중사용 | R11 계정 그대로 | 카트 둘을 번갈아 |

---

## 4. 체크리스트 — 12항목

> **⛔ 를 ✅ 로 반올림하지 않는다.** 1차·2차가 「전 항목 실행, ⛔ 0건」을 지킨 것이 그 기록을 믿을 수 있게 만든 이유다.
> **📸 = 판정 증거 컷**(§5 규칙 참조). ❌ 는 증상 + 요청/응답 + 파일·줄까지 남긴다.

### 4-A. 재실행 (회귀) — 근거는 §0 의 diff 표

#### ★ R11. `customer_registered` 자동발급 e2e — **이 리허설의 본체이자 #775 의 종결 조건** 📸

**2차의 유일한 ❌ 였고, 그것을 고치려고 #775 를 했다.**

1. `AY-WELCOME` 이 `trigger=customer_registered` 로 존재하는지 확인 (§3)
2. `POST /auth/signup` 으로 `retail-demo01@local.test` 가입
3. **스토어프론트(`localhost:8000`) UI 로 로그인** — 여기서 Medusa customer 가 생긴다
4. 🔴 **손으로 이벤트를 강제하지 않는다.** `medusa exec` 도, 발급 라우트 직접 호출도 안 된다.
   그걸 하면 2차가 이미 검증한 뒷단만 다시 보는 것이고, **끊겼던 「입구」는 그대로 미검증**이다.

**판정 5개 — 전부 봐야 ✅:**

```sql
-- ① 장이 생겼는가 / ② issued_via / ③ expires_at 이 validity_days 대로인가
SELECT id, promotion_id, issued_via, issued_at, expires_at, used_at, cart_id
  FROM coupon_grant
 WHERE customer_id = '<cus_...>' AND deleted_at IS NULL;
-- 🔴 order_id 를 넣지 말 것 — #785 가 그 컬럼을 지웠다. 넣으면 쿼리가 죽는다.
```
- ① 행이 **1건** 생겼다
- ② `issued_via = 'customer_registered'`
- ③ `expires_at ≈ issued_at + 30일`
- ④ 스토어프론트 **마이페이지 쿠폰 탭**에 그 쿠폰이 보인다 (📸)
- ⑤ 카운터가 올랐다:
  ```bash
  curl -s localhost:19000/metrics | grep coupon_auto_issue_total
  # coupon_auto_issue_total{trigger="customer_registered",outcome="issued"} 1
  ```
  🔴 **`:19000` 이다.** channel-adapter `:13010` 이 아니다 — 이 트리거는 이제 거길 안 지난다.

**Medusa 로그에 이 줄이 있어야 한다:** `[coupon] 회원가입 자동발급 1장 (customer_id=..., codes=AY-WELCOME)`

#### R11b. `membership_activated` 자동발급 e2e (회귀) 📸

**왜 다시 도나:** #787 이 `inbox-worker.service.ts`(21줄)와 `internal-membership.controller.ts`(7줄)를 건드렸다.
같은 파일에서 옆 소비자를 지웠으므로 **모듈 등록이 조용히 깨졌을 수 있다**
(`@app/events` 의 가장 조용한 실수는 `controllers: []` 미등록이다).

2차 §4 R11b 절차 그대로. 멤버십 활성화 → Kafka → channel-adapter inbox → Medusa 발급 라우트 → 장 생성.
**측정점 주의:** 이 트리거는 **channel-adapter `:13010`** 이 센다.

**부수 확인:** channel-adapter 로그에 `Cafe24Linked`/`Cafe24Unlinked` 핸들러가 등록돼 있는지
(`user-event.consumer.ts` 는 `UserEmailVerified` 만 잘려나가고 살아 있어야 한다).

#### R12. 메트릭 — 이제 **두 곳**이다 📸

```bash
curl -s localhost:13010/metrics | grep -E 'coupon_auto_issue|coupon_issue_inbox'   # channel-adapter
curl -s localhost:19000/metrics | grep -E 'coupon_auto_issue'                       # Medusa (신규)
```

| 시리즈 | 어디서 | 기대 |
|---|---|---|
| `coupon_auto_issue_total{trigger="customer_registered",...}` | **Medusa :19000** | R11 후 `outcome="issued"` 1 |
| `coupon_auto_issue_total{trigger="membership_activated",...}` | **channel-adapter :13010** | R11b 후 증가 |
| `coupon_auto_issue_failures_total{...,kind="permanent"}` | 양쪽 | 정상 경로에선 **없다** |
| `coupon_issue_inbox_failed_rows{event_type=...}` | channel-adapter | `UserEmailVerified` 라벨은 **더 이상 안 나온다** |

🔴 **이름이 같고 라벨이 같다.** Grafana 는 job 구분 없이 합산하도록 의도됐다 — 두 job 에서 **같은 라벨 조합이
동시에 나오면 안 된다**(이중 계수). `trigger` 로 갈리는지 확인한다.

#### R13. 빠른 레인이 «1회만» 되살리는가 (회귀) 📸

**왜 다시 도나:** `coupon-issue-reconciliation.service.ts` 가 **94줄** 바뀌었다. 3차 재실행 항목 중 회귀 위험이 가장 크다.

2차 §4 R13 절차 그대로: 실패 유도 → 15분 빠른 레인이 1회차에 되살림 + `inbox_events.metadata` 에
`coupon_fast_reset` 마커 → **2회차는 무시**(03:00 크론에 넘김).

```sql
SELECT id, event_type, status, attempts, next_attempt_at, metadata
  FROM inbox_events WHERE event_type = 'MembershipStatusChanged' ORDER BY created_at DESC LIMIT 5;
```

### 4-B. 신규 — #775 (subscriber)

#### N1. `has_account` 게이트 — 어드민이 만든 고객에겐 발급되지 않는다 📸

`customer.created` 는 **어드민이 만든 고객에도 뜬다**(코어 `POST /admin/customers`, `has_account=false`).
「회원가입」은 인증 계정이 붙은 고객뿐이다.

1. Medusa 어드민에서 고객을 **손으로** 하나 만든다
2. `SELECT * FROM coupon_grant WHERE customer_id='<그 고객>'` → **0행이어야 한다**
3. 카운터도 **안 올라야 한다** (게이트는 세지 않고 그냥 `return` 한다)

**이게 ❌ 면**(장이 생기면) 개통 시 어드민의 고객 등록이 곧 쿠폰 살포가 된다.

#### N2. 같은 사건은 몇 번 와도 한 장 📸

발급 키는 `trigger:<trigger>` 이고 `idx_coupon_grant_issue_key` 파셜 유니크가 강제한다.

1. R11 의 고객에게 복구 명령을 **두 번** 부른다:
   `POST /admin/customers/<id>/issue-coupons {"trigger":"customer_registered"}`
2. `coupon_grant` 행 수가 **1 그대로**여야 한다
3. 응답의 `skipped[].reason` 이 `already_issued` 여야 한다

#### N3. 실패는 재시도되지 않고 «보인다»

subscriber 에는 **재시도가 없다**(Redis 이벤트버스 기본 `attempts=1`, 스펙 결정 2).
실패는 삼키되 카운터 + 로그로 남긴다.

- 유도: `AY-WELCOME` 을 일시적으로 깨뜨리거나(예: 프로모션을 `inactive`) 새 계정 가입
- 기대: `coupon_auto_issue_failures_total{trigger="customer_registered",kind="permanent"}` 증가
- 기대: Medusa 로그에 **복구 명령이 문자 그대로** 찍힌다 —
  `재시도 없음 — 수동 복구: POST /admin/customers/<id>/issue-coupons {"trigger":"customer_registered"}`
- 그 명령을 실제로 불러 **복구되는지**까지 본다

⛔ 유도 방법을 못 찾으면 ⛔ 로 남긴다. **✅ 로 반올림하지 않는다.**

### 4-C. 신규 — 소모 경로 (PR-2 · PR-3)

🔴 **순서대로 돈다: C1 → C3 → C2 → C4 → C5.** 문서의 번호 순이 아니다.
`AY-WELCOME` 은 R11 이 발급한 **한 장**이고 C1~C3 이 그 한 장을 돌려쓴다 —
C1(소모) → C3(취소로 복원) 을 먼저 해야 C2 가 「쓸 수 있는 장 1개」라는 전제를 갖는다.
C2 를 C3 앞에 놓으면 장이 이미 소모된 상태라 **거절이 옳게 나와도 그게 C2 가 보려는 이유인지 알 수 없다.**

#### C1. 소모 = 검사 — 주문 완료가 장을 잡는다 📸

1. R11 계정으로 `AY-WELCOME` 을 카트에 적용 → **포인트 전액결제**로 주문 완료
   (`POINTS` 는 외부 PG 를 안 탄다 — `docs/local-dev.md` §5)
2. ```sql
   SELECT id, used_at, cart_id, expires_at FROM coupon_grant WHERE customer_id='<cus_...>';
   ```

| 컬럼 | 기대 | 🔴 |
|---|---|---|
| `used_at` | 주문 완료 시각 | |
| `cart_id` | **그 카트 id** | 소모의 키는 주문이 아니라 카트 |

🔴 **`order_id` 컬럼은 없다**(#785 가 지웠다). 주문과의 연결은 **`order_cart` 링크**로 확인한다:
```sql
SELECT order_id, cart_id FROM order_cart WHERE cart_id = '<위에서 본 cart_id>';
```
이 링크가 있어야 C4 의 스위퍼가 그 장을 「주문 있음」으로 보고 놓지 않는다.

3. 마이페이지 **「사용완료」 탭**으로 옮겨갔는지 (📸 — B-03 과 겸함)

#### C2. 이중사용 창이 닫혔는가 — **PR-3 의 존재 이유** 📸

옛 구조는 «읽어서 검사» 와 «써서 소모» 사이가 열려 있어 같은 고객의 두 카트가 장 하나로 **둘 다 통과**했다.

1. **C3 이 되살린 그 한 장**으로 시작한다 (쓸 수 있는 장이 정확히 1개인 상태)
2. 카트 A 에 적용 → 주문 완료 (장이 잡힌다)
3. **카트 B** 에 같은 쿠폰 적용 → 주문 완료 시도
4. **기대: 거절된다.** `consumeOneUsableGrantForCart` 가 `used_at IS NULL` 술어라 못 잡고 → `none` →
   장이 사용을 지배하므로 훅이 던진다
5. 같은 **카트 A** 를 다시 완료 시도하면 `already` 로 **통과**해야 한다(재시도는 스스로 낫는다)

🔴 **4와 5를 헷갈리지 말 것.** 다른 카트 = 거절, 같은 카트 = 통과. 술어가 다르다.

#### C3. 주문 취소가 장을 되살린다 (A2 의 쿠폰 축) 📸

`order.canceled` → 구독자가 **`order_cart` 링크로** 카트를 찾아 `restoreGrantsByCart`.

1. C1 의 주문을 **취소**한다
2. ```sql
   SELECT used_at, cart_id FROM coupon_grant WHERE id='<그 장>';
   ```
   **기대: `used_at IS NULL` AND `cart_id IS NULL`** (복원은 둘 다 비운다)
3. 마이페이지에서 **다시 「내 쿠폰」** 탭으로 돌아왔는가 (📸)
4. 실제로 **다시 쓸 수 있는가** — 새 카트에 적용해 주문까지

**되살리지 않는 두 경우도 본다(있으면):** 이미 **만료된** 장 · 어드민이 **회수한**(`revoked_at`) 장.

⚠️ **R14(2차)의 `campaign_budget_usage` 미반환은 별개 문제이고 여전히 미해결이다.** 여기서 보는 것은
**장(`coupon_grant`)의 복원**이다. 둘을 같은 항목으로 적지 말 것.

#### C4. 스위퍼 — 「주문 없는 소모」만 되돌리고 정상 주문은 놓지 않는다

프로세스가 훅 커밋 직후에 죽으면 장이 «카트가 잡았는데 주문은 없는» 채로 남는다. 보상은 살아있는 프로세스만 돈다.

1. `COUPON_STUCK_MIN_AGE_MINUTES=1` 확인 (§2-1)
2. **고아 소모를 만든다.** 카트에 쿠폰을 적용한 뒤 주문 완료 **직전에 멈추는** 방법이 없으므로,
   가장 싼 재현은 **버릴 장 하나**를 골라 손으로 상태를 만드는 것이다.
   🔴 **C1~C3 이 쓰는 장을 쓰지 말 것** — 별도 계정에 손으로 한 장 발급해 그걸 쓴다.
   ```sql
   -- 주문 없는 카트 id 하나: SELECT id FROM cart WHERE completed_at IS NULL ORDER BY created_at DESC LIMIT 1;
   UPDATE coupon_grant SET cart_id = '<주문 없는 카트 id>', used_at = now() - interval '5 minutes'
    WHERE id = '<버릴 장 id>';
   ```
   `used_at` 을 5분 전으로 **백데이트하므로 기다릴 필요가 없다**(`minAge` 1분 > 5분 전). 
   스위퍼의 **판정 로직**을 보는 것이 목적이지 프로세스 사망을 재현하는 것이 목적이 아니다.
3. 손으로 돌린다:
   ```bash
   (cd apps/medusa && npx medusa exec ./src/scripts/restore-stuck-coupon-consumptions.ts)
   ```
4. **기대 로그:** `[coupon] 스위퍼 {"scanned":N,"restored":1,"kept":N-1}` +
   `[coupon] 주문 없는 소모 1장 되돌림 (cart_id=...)`
5. 🔴 **가장 중요한 판정: 정상 주문의 장은 `kept` 에 들어가야 한다.** `order_cart` 링크가 있거나
   카트가 `completed_at` 을 가지면 놓지 않는다. **정상 주문이 restored 에 들어가면 ❌ — 개통하면 안 된다.**
6. **끝나면 `COUPON_STUCK_MIN_AGE_MINUTES` 를 되돌린다**(§2-1 경고)

#### C5. 훅 보상 — 뒤 스텝이 실패하면 장이 돌아온다 ⛔ 허용

`validate` 훅이 잡은 장은 **뒤 스텝(주문 생성·재고예약·결제 승인)이 실패할 때** 훅 보상이 되돌린다.

**시도해 볼 방법:** 재고를 0으로 만들어 예약 스텝을 실패시킨다 (카트 적용 뒤, 주문 완료 직전에 재고를 뺀다).

**성공하면:** `used_at IS NULL` · `cart_id IS NULL` 로 돌아와야 한다.
**안정적으로 유도하지 못하면 ⛔ 로 남긴다.** 자동 통합 스펙이 이 경로를 덮고 있으므로
(`coupon-consume.spec.ts`) ⛔ 하나로 개통을 막지는 않는다 — 다만 **기록에 그렇게 적는다.**

---

## 5. 스크린샷 대본 — 📸 와 📷 는 다른 물건이다

🔴 **요구가 정반대다. 한 컷으로 겸하려 들면 둘 다 못 쓴다.**

| | 📸 증거 컷 | 📷 가이드 컷 |
|---|---|---|
| 목적 | 리허설 판정의 **반증 가능한 근거** | 리테일팀이 보는 **설명 그림** |
| URL·시각·콘솔 | **보여야 한다** | **없어야 한다** (크롭) |
| 데이터 | 있는 그대로 (`cus_01J...` 그대로 OK) | 실물 이름만. id·이메일은 크롭하거나 가린다 |
| 붙는 곳 | #488 코멘트 | 스크래치패드 → 나중에 가이드 문서 |
| 실패 화면 | 필요하면 찍는다 | **B절만** 의도적으로 찍는다 (거절 메시지) |

**같은 화면을 두 번 찍는 비용이 붙는다. 그게 정직한 가격이다.**

### 5-1. 저장 규칙

```
<스크래치패드>/screenshots/
  ├── manifest.md          ← 🔴 컷과 한 몸. 이게 없으면 한 달 뒤 쓰레기다
  ├── A-01-쿠폰목록.png
  ├── A-02-쿠폰생성-기본정보.png
  └── ...
```

**파일명:** `<절>-<번호>-<슬러그>.png` — 절은 `A`/`B`/`C`, 증거 컷은 `E-<항목>-<슬러그>.png` (예: `E-R11-마이페이지.png`)

**`manifest.md` 한 줄 형식:**
```
| 파일 | 절 | 무엇을 보여주는가 | 캡션 초안 |
```
캡션 초안까지 **찍은 그 자리에서** 적는다. 나중에 40장을 놓고 기억해내려 하지 말 것.

### 5-2. A절 — 쿠폰 만들기 (어드민 매뉴얼)

**대상 화면:** admin-web `localhost:8002` → `/mall/marketing/coupons`

| 컷 | 화면 | 무엇을 보여주려고 |
|---|---|---|
| A-01 | 쿠폰 목록 | 어디서 시작하는가 |
| A-02 | 생성 다이얼로그 — 기본 정보 | 이름·코드(자동 생성 버튼) |
| A-03 | 할인 설정 — **정률** | 할인율 칸이 placeholder 라는 것 |
| A-04 | 할인 설정 — **정액** | 「최대 할인금액」이 **사라진** 상태 |
| A-05 | **최대 할인금액(캡) 필드** | 정률에서만 뜬다. `AY-SHIPHALF` |
| A-06 | 적용 대상 3종 | 주문 전체 / 특정 상품 / 배송비 |
| A-07 | **유효기간 두 축** | 발급 가능 기간 ↔ `validity_days`(발급받은 날부터 N일) |
| A-08 | 공개 범위 | `claimable` ↔ `assigned_only` 의 의미 |
| A-09 | 생성 완료 후 목록 | 6장이 나열된 상태 |
| A-10 | 쿠폰 상세 다이얼로그 | 만든 뒤 확인하는 자리 |
| A-11 | 고객 목록 다이얼로그 | 누가 받았나 (`issued_via` 가 보이는 자리) |
| A-12 | 발급 다이얼로그 | 손으로 발급하는 법 |

🔴 **A-07 이 이 가이드의 핵심 컷이다.** 「두 축」은 리테일팀이 가장 틀리기 쉬운 개념이고,
틀리면 «캠페인 끝났는데 왜 고객 쿠폰이 살아있냐» 는 문의로 돌아온다.

### 5-3. B절 — 고객 화면 / CS 응대

**대상 화면:** 스토어프론트 `localhost:8000`

| 컷 | 화면 | 무엇을 보여주려고 |
|---|---|---|
| B-01 | 마이페이지 → **「내 쿠폰」** 탭 | 고객이 보는 기본 화면 |
| B-02 | **「쿠폰 받기」** 탭 | `claimable` 쿠폰이 여기 뜬다 |
| B-03 | **「사용완료」** 탭 | 「12/31까지 · 사용완료」 배지 (날짜는 미래일 수 있다) |
| B-04 | **「만료 쿠폰」** 탭 | 만료일이 지난 것만 |
| B-05 | 체크아웃 — 쿠폰 적용 성공 | 할인액이 붙은 모습 |
| B-06 | 체크아웃 — **「적용 조건 미충족」** | 🔴 CS 문의 1순위 |
| B-07 | 체크아웃 — **캡이 물린 정률 쿠폰** | 50%인데 2,000원만 깎인 이유 |
| B-08 | 쿠폰 클레임 페이지 (`/coupons/claim`) | 링크로 받는 경로 |

🔴 **B-03 은 함정 설명이 필요한 컷이다.** 카드에 뜨는 날짜는 «그 쿠폰의 만료일» 이라 **사용완료인데 미래 날짜**가 보인다.
캡션에 그걸 적어두지 않으면 CS 가 버그로 오해한다.

### 5-4. C절 — 자동발급 브리핑

| 컷 | 화면 | 무엇을 보여주려고 |
|---|---|---|
| C-01 | 생성 폼의 **자동발급 트리거** 선택 | 「회원가입 완료」/「멤버십 시작」이 어디 있나 |
| C-02 | 고객 목록 다이얼로그 — `issued_via` | 자동발급된 장이 어떻게 보이나 |
| C-03 | 마이페이지 — 가입 직후 받은 쿠폰 | 고객이 실제로 보는 결과 (R11 의 ④와 겸함) |

**C절에는 회원가입 화면을 넣지 않는다.** 관리자용 «쿠폰 기능» 가이드에 가입 절차는 필요 없다.
(로컬에서 가입 UI 를 못 지나는 §2-3 ③ 제약은 **실행상의 문제일 뿐** 가이드 범위와 무관하다.)

---

## 6. 결과를 어디에 남기나

🔴 **한 항목이 끝날 때마다 즉시 적는다.** 앱 8개 · 12항목 · 스크린샷 30여 장짜리 긴 작업이라,
마지막에 몰아쓰려다 중간에 끊기면 앞이 통째로 사라진다. **스크래치패드에 누적하고 끝에 옮긴다.**

1. **#488 에 「리허설 3차 실행 기록」 코멘트** — 1·2차와 같은 표(항목 / 결과 / 비고), 맨 위에 **브랜치·커밋 해시·실행일**
2. **#775 에 R11 결과 코멘트** — ✅ 면 **거기서 이슈를 닫는다**(종결 조건이 R11 재실행이다)
3. **마스터플랜** 진행 상황 갱신
4. ❌ 는 이슈로 뽑거나 #488 항목으로 편입. **❌ 를 남긴 채 개통하지 않는다**
5. ⛔ 를 ✅ 로 반올림하지 않는다
6. **📷 가이드 컷은 #488 에 붙이지 않는다** — 스크래치패드 + `manifest.md` 로 두고,
   가이드 문서를 쓸 때 옮긴다. 증거 컷(📸)만 코멘트에 붙는다

---

## 7. 통과 뒤 — A5 개통

**#787 은 이미 배포됐다.** 남은 것은 **플래그 한 줄**이다.

1. **라이브 재실측** — 플래그를 켜는 순간 발화하므로 규칙 수를 먼저 본다:
   ```sql
   SELECT auto_issue_trigger, count(*) FROM promotion_meta
    WHERE auto_issue_trigger IS NOT NULL AND deleted_at IS NULL GROUP BY 1;
   ```
   **의도한 것 외에 있으면 멈춘다.**
2. **플립** — `deployments/lcnine/services/infra/services.ts` 의 Medusa `environment` 에:
   ```ts
   COUPON_AUTO_ISSUE_ENABLED: 'true',
   ```
3. `sst deploy --stage live`
4. **개통 확인** — 발급이 아니라 시리즈의 «존재» 로 본다:
   ```promql
   sum by (trigger, outcome) (increase(coupon_auto_issue_total[1h]))
   ```
5. **되돌리기** — 그 한 줄을 지우고 재배포. 이미 발급된 장은 남는다(회수는 어드민에서 건별)

### 7-1. 리허설과 독립적으로 «지금» 확인할 것 — 배포가 끝났으므로

- **Alloy 스크레이프 실효:** `up{job="medusa"} == 1` — #787 이 신설한 배관이 실제로 붙었는가.
  **0 이면 R12 가 로컬에서 초록이어도 라이브 관측은 없다.**
- **Grafana 정리:** `coupon_issue_inbox_failed_rows{event_type="UserEmailVerified"}` 를 참조하는 패널·알림이
  있으면 **영구 No Data** 가 된다(그 경로를 지웠다). 찾아서 정리한다.
- ⚠️ 발급 시리즈 자체는 **플래그가 꺼져 있는 동안 없는 게 정상**이다. `No Data → Alerting` 매핑 금지.

---

## 8. 이 리허설이 다루지 않는 것

- **R1~R10 · R14 재실행** — 2차가 닫았다. §3 이 그 쿠폰을 다시 만드는 것은 **스크린샷 때문**이지 재검증이 아니다
- **`campaign_budget_usage` 미반환 (A2 의 예산 축)** — 여전히 미해결. C3 은 **장의 복원**만 본다
- **Firebase 경로(`Cafe24Linked`/`Cafe24Unlinked`)** — 외부 자격증명 필요. R11b 가 뒷단을 덮는다
- **실 PG 결제** — 포인트 전액결제로 우회
- **다중 인스턴스 동시성** — 로컬 단일 프로세스라 스위퍼 중복 실행·리더 선출 부재를 재현 못 한다
- **`user.updated`·`user.deleted` subscriber 사망 (#786)** — 탈퇴 익명화 미전파(PII). **쿠폰보다 급하지만 별개 이슈다**
- **CS 조회 화면(P8)** — 백엔드만 있고 admin-web 호출부 0건
- **가이드 문서 작성 자체** — 3차는 **컷과 manifest 까지**. 문서는 별도 작업

---

## 9. 새 세션 시작 지침 (복붙용)

리허설은 컨텍스트를 많이 먹으므로 **전용 세션**에서 돌린다. 아래를 그대로 붙여 시작한다.

```
쿠폰 개통 리허설 3차를 진행한다. 사람이 손으로 돌리는 절차고, 나는 그 절차를 안내·구동·기록한다.

지침서: docs/superpowers/plans/2026-09-05-coupon-rehearsal-3.md
  — 이 문서 하나로 실행 가능하게 썼다. 먼저 전문을 읽어라.
  — 환경 «구축» 절차는 여기 없다. docs/local-dev.md 「전체 스택 로컬 구동」 +
    docs/superpowers/plans/2026-09-01-coupon-rehearsal-2.md §2 가 정본이고,
    3차 지침서 §2 는 그 둘과의 «차이»만 적는다. 셋을 다 봐야 한다.

브랜치: develop. #787(#775)은 이미 라이브에 배포됐다 — 로컬 develop 이 라이브와 같은 코드다.
  그래도 리허설은 로컬에서 돈다(라이브에서 신규 가입·주문·취소를 만들 수 없다).

목적이 둘이다:
  ① 검증 — 12항목(R11·R11b·R12·R13 / N1~N3 / C1~C5). A5 개통의 마지막 관문이다.
  ② 촬영 — 리테일팀 «쿠폰 기능» 가이드에 넣을 스크린샷. 지침서 §5 가 대본이다.
  🔴 §5 의 «📸 증거 컷 ≠ 📷 가이드 컷» 구분을 먼저 읽어라. 한 컷으로 겸하면 둘 다 못 쓴다.

규칙:
  - 12항목 전부 실행한다. 못 돌린 항목은 ⛔ 로 남기고 ✅ 로 반올림하지 않는다.
    1·2차가 「전 항목 실행, ⛔ 0건」을 지킨 것이 그 기록을 믿을 수 있게 만든 이유다.
  - 📸 항목은 스크린샷 없이는 ✅ 의 근거가 없다.
  - ❌ 는 증상 + 요청/응답 + 파일·줄까지 남긴다. 그 자리에서 조용히 고치지 말고 먼저 기록해라.
  - 🔴 한 항목을 끝낼 때마다 결과를 스크래치패드에 «즉시» 적어라. 스크린샷은 찍은 자리에서
    manifest.md 에 캡션 초안까지 적어라. 마지막에 몰아서 쓰지 마라.
  - 결과는 #488 「리허설 3차 실행 기록」 코멘트 + #775 (R11 이 ✅ 면 거기서 닫는다) + 마스터플랜.
  - 로컬 .env 는 커밋하지 않는다.

크롬 자동화를 쓴다:
  - claude-in-chrome 스킬을 먼저 부르고, tabs_context_mcp 로 컨텍스트를 잡은 뒤 새 탭을 만든다.
    기존 탭을 재사용하지 않는다.
  - localhost:8000(스토어프론트)·localhost:8002(admin-web) 사이트 권한이 확장에 있어야 한다.
  - 네이티브 alert/confirm 을 띄우지 마라 — 뜨면 확장이 먹통이 되고 사람이 직접 닫아야 한다.
  - 2~3회 실패하면 같은 동작을 반복하지 말고 멈춰서 나에게 물어라.
  - 🔴 자동화는 «구동기»지 «심판»이 아니다. 판정이 애매하면 ✅ 로 넘기지 말고 스크린샷과 함께
    나에게 확인을 요청해라.

가장 조용히 실패하는 지점 넷 — 막히면 여기부터 의심해라 (지침서에 상세히 있다):
  1. apps/medusa/.env 의 COUPON_AUTO_ISSUE_ENABLED=true 누락 → 발급이 빈 배열만 반환
  2. R11 에서 스토어프론트 «UI 로그인»을 건너뜀 → Medusa customer 가 안 생겨 트리거 자체가 없음
  3. COUPON_STUCK_MIN_AGE_MINUTES=1 을 C4 뒤에 안 되돌림 → 스위퍼 크론이 정상 소모를 되돌림
  4. 메트릭을 엉뚱한 포트에서 찾음 → customer_registered 는 Medusa :19000,
     membership_activated 는 channel-adapter :13010. 트리거마다 측정점이 다르다

리허설이 통과하면 A5 개통(플래그 한 줄 + sst deploy)은 그 뒤 별도 작업이다.
```

### 🔴 자동화가 늘리는 위험 — 이것만은 읽고 시작한다

브라우저 자동화는 **처리량을 올리는 만큼 «거짓 초록» 도 올린다.** 에이전트가 페이지를 잘못 읽고 ✅ 를 적으면
1차보다 **나쁜** 기록이 된다 — 1차는 적어도 사람 눈이 봤다.

그래서 📸 규칙이 있다. 스크린샷이 붙은 ✅ 는 나중에 반증 가능하고, 안 붙은 ✅ 는 아니다.
**자동화의 값어치는 속도가 아니라 그 증거에 있다.**

**3차는 그 위험이 2차보다 크다** — 촬영 때문에 자동화 부하가 늘고, 「컷을 얻었다」가 「검증했다」로
미끄러지기 쉽다. **📷 를 찍은 것은 아무것도 검증하지 않는다.** 판정은 📸 와 SQL·메트릭이 한다.

환경 구축(§2)은 자동화 대상이 아니다 — 앱 8개·env·시드는 터미널 작업이다.
