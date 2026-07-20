# Runbook — almondyoung.com 도메인 컷오버 (almondyoung-next.com → almondyoung.com)

레거시 cafe24 몰이 쓰던 `almondyoung.com` 을 신규 플랫폼의 정식 도메인으로 전환한다. cafe24
몰은 은퇴하지 않고 cafe24 기본 도메인 `lcnine.cafe24.com` 으로 계속 서빙되며, 특정 레거시
페이지(마이그레이터/주문·마일리지 조회)만 접근 가능하게 두고 메인 등은 신규 몰로 리다이렉트한다.

- Route53 hosted zone: **`almondyoung.com` = `Z057220710PLMY0VI9LCN`** (NS 는 이미 AWS 위임 완료)
- 이 브랜치(`feat/almondyoung-domain-cutover`) **머지 + `sst deploy` 하는 순간이 곧 컷오버**다.
- 스키마 변경 없음 → `db:migrate` 불필요.

---

## 1. 이 브랜치가 바꾼 것 (코드)

| 영역 | 파일 | 변경 |
|---|---|---|
| baseDomain (services) | `deployments/lcnine/services/infra/shared.ts` | live 도메인 `almondyoung-next.com` → `almondyoung.com` |
| baseDomain (auth) | `deployments/lcnine/auth/infra/shared.ts` | 동일 |
| storefront 정체성 | `web/almondyoung-storefront/src/lib/config/site.ts` | `domainName` → `almondyoung.com` (canonical/OG/sitemap) |
| cafe24 마이그레이터 링크 ×4 | `cafe24-link-banner`, `cafe24-link-popup`, `legacy-account-migration-card`, `mypage/.../cafe24-link-section` | `almondyoung.com/migrator/...` → `lcnine.cafe24.com/migrator/...` |
| 레거시 주문/마일리지 redirect | `services/infra/services.ts` (env) + storefront fallback ×4 | `almondyoung.com/myshop/...` → `lcnine.cafe24.com/myshop/...` |
| user-service CORS (migrator origin) | `auth/infra/services.ts` `CORS_ORIGIN_DOMAINS` | `almondyoung.com`/`www` → `lcnine.cafe24.com` |
| Medusa/wallet origin dedupe | `services/infra/services.ts` STORE_CORS/AUTH_CORS/WALLET_ALLOWED_RETURN_ORIGINS | 하드코딩 `almondyoung.com`/`www` 제거 (이제 `storefrontUrl`/`url('www')` 와 동일) |
| cafe24 migrator 마스터본 | `apps/user-service/static/migrate.js` | apiBase → `user.almondyoung.com`, 로그인 redirect → `lcnine.cafe24.com/member/login.html` |

**자동 파생되는 것** (baseDomain 만 바꾸면 따라옴): 모든 서비스 hostname, `COOKIE_DOMAIN`,
`PARENT_COOKIE_DOMAIN`, `ALLOWED_REDIRECT_HOSTS`, OIDC issuer/JWKS/redirect env, ACM 인증서.

---

## 2. 배포 전 준비 (deploy 전에 끝내둘 것)

- [ ] **cafe24 어드민**: 몰 대표도메인을 `almondyoung.com` → `lcnine.cafe24.com` 으로 전환.
      메인 페이지 등은 신규 몰(`https://almondyoung.com`)로 리다이렉트 설정. 마이그레이터/주문/
      마일리지 페이지는 `lcnine.cafe24.com/migrator/...`, `/myshop/...` 로 그대로 열리는지 확인.
- [ ] **cafe24 migrator 자산 재업로드**: `apps/user-service/static/{confirm.html,migrate.js}` 의
      마스터본을 cafe24 `/migrator/` 경로에 재업로드. migrate.js 는 `user.almondyoung.com` 을
      호출하므로 **user-service 가 새 도메인으로 뜬 뒤(3-c 이후)** 반영해야 404 를 피한다.
- [ ] **oauth_clients redirect URI** 갱신 (SoT = user-service `oauth_clients` DB, env 아님).
      auth-web `/dev/oidc-clients` (DEV_TOOLS_ENABLED=true) 에서. **신규 URI 를 먼저 add(옛것 병존)**,
      컷오버 검증 후 옛것 제거:
      - `medusa-storefront`: + `https://almondyoung.com/kr/callback/oidc`, `https://www.almondyoung.com/kr/callback/oidc`
      - `admin-web`: + `https://admin.almondyoung.com/auth/callback`
      - `wallet-web`: + `https://wallet-web.almondyoung.com/auth/callback`
      - `dabeau`: 변경 없음 (`api.dabeau.kr`, 별도 도메인)
- [ ] **이메일: 컷오버 블로커 아님** — 프로덕션 트랜잭션 메일 발송 경로가 없어 별도 조치 불필요. (7절 참고.)
- [ ] 저트래픽 **유지보수 창** 공지 + **전 사용자 재로그인 예고** (issuer 변경 → 기존 세션 무효).

---

## 3. 배포 당일 순서 (엄수)

issuer/도메인 변경은 auth 가 SoT 이고 services 가 auth 의 SSM 값을 late-binding 으로 읽으므로
**auth → services** 순서. 그 사이에 `*` CNAME 을 지운다(services 의 wildcard ALB 레코드와 충돌하므로).

- **a.** 브랜치 머지 (develop).
- **b. auth 스택 배포**: `cd deployments/lcnine/auth && npx sst deploy --stage live`
      → `user.almondyoung.com` / `auth.almondyoung.com` + ACM 인증서 생성/검증. (`*` CNAME 이 있어도
      specific 레코드라 충돌 없음.)
- **c. 레거시 `*.almondyoung.com` CNAME 삭제** (아래 4절 명령). services wildcard ALB 가
      `*.almondyoung.com` alias 를 만들려면 이 CNAME 이 없어야 한다.
- **d. services 스택 배포**: `cd deployments/lcnine/services && npx sst deploy --stage live`
      → `*.almondyoung.com`(wildcard ALB), apex `almondyoung.com`(CloudFront, override 로 cafe24 A 덮어씀),
      `www`(→apex 301), `admin`/`wallet-web`/`medusa`/`core`/... 라우팅 생성.
- **e.** cafe24 migrator 자산 재업로드 (2절), oauth_clients 옛 URI 제거.
- **f.** 검증 (5절).

> ⏱ **인증서 전파**: CloudFront 인증서는 us-east-1 + 배포 반영에 20~40분+ 걸릴 수 있다. apex/`www`/
> admin/wallet-web 이 잠시 인증서 오류일 수 있으니 창을 넉넉히. b~d 사이 `almondyoung.com` 서브도메인은
> `*` CNAME 삭제 후 specific 레코드 생성 전까지 잠시 미해석 — cafe24 몰은 이미 `lcnine.cafe24.com` 이라 무방.

---

## 4. DNS 작업 (Route53, `Z057220710PLMY0VI9LCN`)

### 유지 (건드리지 말 것)
`NS`, `SOA`, apex `MX`(feedback-smtp), apex `TXT`(SPF), `resend._domainkey`(DKIM),
`send.almondyoung.com` `MX`/`TXT` — 전부 Resend/SES 발신 설정. **인바운드 메일함 없음** → 이메일 리스크 없음.

### 덮어씀 (SST 자동)
apex `A`(현재 cafe24 IP 4개) → storefront 가 `dns: sst.aws.dns({ override: true })` 로 CloudFront alias 로 교체. 수동 조치 불필요.

### 삭제 (3-c, 수동 — services 배포 직전)
```bash
aws route53 change-resource-record-sets --hosted-zone-id Z057220710PLMY0VI9LCN --profile login \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "*.almondyoung.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{ "Value": "almondyoung.com" }]
      }
    }]
  }'
```
> 이 `*` CNAME 은 NS 위임 시 cafe24 catch-all 을 미러링해 둔 것. 삭제하면 SST wildcard ALB 가
> `*.almondyoung.com` 을 깨끗이 점유한다. **삭제 전 반드시 cafe24 몰이 `lcnine.cafe24.com` 으로
> 이전 완료**돼 있어야 한다(안 그러면 www 등이 죽음).

---

## 5. 배포 후 검증

- [ ] `https://almondyoung.com` → 신규 storefront (apex), `https://www.almondyoung.com` → apex 301.
- [ ] `https://user.almondyoung.com/.well-known/openid-configuration` issuer = `https://user.almondyoung.com`,
      `/.well-known/jwks.json` 200.
- [ ] admin/wallet-web/medusa/core 서브도메인 HTTPS 정상 + 인증서 유효.
- [ ] OIDC 로그인 왕복 (storefront/admin/wallet-web) — redirect_uri mismatch 없이 콜백 성공.
- [ ] cafe24 마이그레이션 플로우: storefront 배너/팝업 → `lcnine.cafe24.com/migrator/confirm.html` →
      `/cafe24/member-info` CORS 통과 → 신규 몰 복귀.
- [ ] 마이페이지 레거시 주문/마일리지 링크 → `lcnine.cafe24.com/myshop/...` 정상.
- [ ] (해당 시만) 이메일 — 현재 프로덕션 발송 경로 없음이므로 스킵 가능. 7절대로 처리한 경우에만 발송/DKIM 검증.

---

## 6. 롤백

인증서/CloudFront 전파 지연 때문에 **사실상 단방향**. 문제 시: 두 `shared.ts` + `site.ts` 를 되돌려
재배포하고, 삭제한 `*` CNAME 을 재생성(위 batch 의 Action 을 `CREATE` 로). 단 DNS/ACM 전파로 즉시
복구는 안 되므로, 되돌리기보다 **전진 수정(fix-forward)** 을 우선 검토.

---

## 7. 후속 / 알려진 비핵심 갭

- **옛 도메인 `almondyoung-next.com` 처리 결정 필요**: baseDomain 이 바뀌면 SST 가 더 이상 관리 안 하므로
  옛 도메인은 미해석이 된다. 북마크/외부링크/SEO 링크에쿼티를 위해 유예기간 동안 `*.almondyoung-next.com`
  → `almondyoung.com` 301 을 별도로 둘지 결정 (별도 리다이렉트 스택 필요). 안 두면 그냥 죽음.
- **데모 이미지의 cafe24 CDN URL**: `order/track/page.tsx`, `home/.../purchase-report-section.tsx` 등에
  `https://almondyoung.com/web/product/...` 하드코딩(레거시 cafe24 CDN, 목업 데이터). 컷오버 후 깨짐 —
  cafe24 는 `lcnine.cafe24.com/web/product/...` 로도 동일 서빙하므로 repoint 가능하나, 그럴 경우
  `next.config.js` remotePatterns 에 `lcnine.cafe24.com` 추가 필요. 목업이라 우선순위 낮음.
- **실 상품/콘텐츠 데이터의 레거시 이미지 URL 감사**: DB 에 `almondyoung.com/web/product/...` 를 참조하는
  실데이터가 있으면 컷오버 후 깨짐 → S3/file-service 로 이관.
- **외부 콘솔 콜백/webhook 갱신**: Toss/Nicepay(결제 redirect·webhook), Kakao/Naver 소셜 콜백,
  마켓플레이스(Naver/Coupang), GA4 스트림 URL, Google Search Console(신규 속성 + change of address).
- **이메일 (저우선, 블로커 아님)**: notification 의 Resend 이메일 채널은 스캐폴딩 + 마케팅/테스트 blast 용.
  order-email consumer(`order-event.consumer.ts:61,101`)는 `customerEmail` 이 TODO/임시 스텁이고,
  user-service 가입 인증은 SMS(Twilio)라 **프로덕션 트랜잭션 메일 트리거가 없다**. 따라서 컷오버로
  `RESEND_FROM`(`services.ts:251`, `noreply@mail.${baseDomain}` → `noreply@mail.almondyoung.com`, 미검증
  서브도메인)이 되어도 실제 깨질 발송이 없다. **브랜드 명의로 고객 메일을 실제로 발송하기 시작할 때** 처리:
  (a) Resend 에서 `mail.almondyoung.com` 인증 + DKIM(`resend._domainkey.mail.almondyoung.com`)/SPF/
  MAIL FROM(`send.mail.almondyoung.com`)을 `Z057…` 에 추가, 또는 (b) `RESEND_FROM` 을 이미 검증된
  apex(`noreply@almondyoung.com`)로 변경. `_dmarc.almondyoung.com` 도 그때 신설.
- **문서**: `deployments/CONVENTIONS.md`, `docs/adr/0023`, `docs/runbooks/selmate-stock-pipeline.md` 등에
  남은 `almondyoung-next.com` 예시/서술은 역사적 맥락이라 미변경.
