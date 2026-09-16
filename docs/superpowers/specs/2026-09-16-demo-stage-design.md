# 발주·물류 시연용 SST demo stage 설계안

상태: 사용자 승인 후 구현·배포 및 실제 업무 API 검증 완료 (2026-09-17 KST). 아래 내용은 승인 당시 설계이며, 실제 배포 및 검증 결과는 [운영 메모](../reports/2026-09-16-demo-operations.md)에 기록한다.
조사 기준: 2026-09-16, 저장소 HEAD `5f2d879db`. live 구성은 저장소의 SST 선언을 기준으로 분석했으며, 실제 live 배포 전체와의 일치는 아직 검증하지 않았다.

## 1. 목적과 확정된 조건

- SST stage 이름은 `demo`, 기반 도메인은 `almondyoung-next.com`.
- 기존 관리자와 물류 앱에서 발주, 입고, 적치, 이동, 재고, 출고 작업을 시연한다.
- 사용자는 실제 고객이 아니다. Medusa·storefront 등 소비자 서비스는 필요하지 않다.
- live의 업무 처리·인증·이벤트·재고 원장 흐름을 유지하고, 시연에 불필요한 서비스만 제외한다.
- **사용자 확인: 외부 업무 연동은 모두 모의 처리한다.** 택배, 판매채널, SMS/알림톡/이메일, 결제 등 실제 업무 호출을 하지 않는다. AWS 인프라와 관측 도구 이용은 별개다.
- 주문 생성은 demo 전용 콘솔에서 반복 가능하게 한다.

## 2. 조사 결과와 설계에 미치는 영향

### 도메인은 완전히 비어 있지 않다

AWS 읽기 전용 조회로 public hosted zone `Z08943483ND41KEF2S058`을 확인했다. apex와 `www`의 A/AAAA는 `dv58utd4da0gu.cloudfront.net`을 가리킨다.

해당 CloudFront `E1QMD0LBMLRNP0`은 Enabled이며, 설명은 almondyoung.com으로의 redirect다. aliases에 `www.almondyoung.com`, `almondyoung-next.com`, `www.almondyoung-next.com`이 함께 들어 있다. 실제 HTTP redirect 응답은 이번 조사에서 검사하지 않았다.

**초기 배포는 비어 있는 admin/auth/user/core/file 등의 서브도메인만 사용한다. 이 CloudFront를 삭제하면 live의 www에도 영향을 줄 수 있으므로 삭제하지 않는다.** 향후 apex를 demo 진입점으로 바꾸려면 기존 소유 스택에서 next 도메인 aliases만 분리하는 별도 변경으로 다룬다. 기존 인증서 검증 및 메일 레코드도 일괄 삭제하지 않는다.

### stage 이름만 추가해서는 안 된다

`auth/infra/shared.ts`, `services/infra/shared.ts`는 `stage !== live`를 모두 dev로 취급한다. 따라서 현재 상태에서 `--stage demo`를 실행하면 `*.dev.lcnine-dev.com`에 배포하려 한다. auth와 services가 같은 stage 설정을 참조하도록 도메인/프로필을 분리해야 한다.

SST app 이름과 SSM 경로는 이미 stage 분리를 지원한다. `lcnine-platform`, `lcnine-auth`, `lcnine-services`를 유지하고 `/lcnine-*/demo/*`를 사용한다.

### 제거할 서비스의 간접 의존성도 정리해야 한다

현재 services 설정은 모든 서비스의 시크릿을 먼저 선언하고 Redis·OpenSearch를 무조건 만든다. 앱 생성문만 감싸면 불필요한 인프라와 시크릿 요구가 남는다. admin-web의 URL/proxy/menu와 seed registry까지 같은 서비스 선택을 반영해야 한다.

파일 버킷은 현재 file-service의 `almondyoung-demo`, auth의 `almondyoung`처럼 하드코딩돼 있다. 이름에 demo가 들어 있다고 전용 자원으로 간주하지 않고 demo stage 소유 버킷을 새로 연결한다.

### 판매 주문 생성과 출고 연결은 다른 단계다

`SalesOrdersService.create()`와 `confirm()`만으로 V2 출고 생성 backlog까지 연결되지 않는다. `OrderEventsConsumer.handleOrderCreated()`는 결제확정 상태와 cutover 조건을 검사하고 출고 생성 backlog를 등록한다.

따라서 주문 생성 콘솔은 기존 channel-adapter 주문 수신/발행 경로를 재사용한다. DB에 판매주문 행만 넣거나 Kafka에 임의 JSON을 보내는 방식으로 만들지 않는다. 기존 typed publisher, outbox, consumer 검증과 멱등성 경계를 유지한다.

### 발주 추천에는 과거 이력이 필요하다

수요 집계·발주 추천은 core의 replenishment 모듈에 있다. 현재 기본 분류 창은 365일, 빈번 수요 계산 창은 90일, 납기 관측 최소 수는 5회다. 최근 주문 몇 건만 넣으면 의미 있는 발주 추천을 보여주기 어렵다.

현재 `db:seed:demo`의 demo 그룹은 다른 용도의 `demo-salon`이다. 이번 시연 데이터가 이미 있다고 가정하지 않고 별도 `demo-logistics` 프로필을 만든다.

## 3. 선택지와 추천

| 접근 | 장점 | 한계 |
| --- | --- | --- |
| live 전체 복제 후 Medusa/storefront만 제거 | 서비스 구성 차이가 작음 | 결제·멤버십·리뷰·검색 및 시크릿·배치가 불필요하게 남음 |
| **업무 서비스 유지 + 외부 어댑터 모의 처리** | 주문 수신부터 통계·물류까지 실제 경로를 시연, 소비자 앱 제거 | 모의 어댑터와 서비스 선택 설정 구현 필요 |
| core/admin/auth만 배포 | 자원이 가장 적음 | 채널 처리·통계·알림 경로가 빠지고 demo만의 주문 수신 구현이 필요 |

두 번째를 추천한다. 비용 최적화를 위해 인증 DB를 합치거나 Kafka를 제거하는 등의 구조 변경은 이번 범위에 포함하지 않는다.

## 4. 배포 범위

| 구성 | 결정 | 이유/조건 |
| --- | --- | --- |
| core | 유지 | 상품/SKU, 주문, 발주·수요예측, 재고, 입출고 |
| admin-web | 유지 | 기존 업무 화면 + demo 콘솔 |
| user-service, auth-web | 유지 | 실제 로그인, 역할·창고 권한, OIDC |
| file-service | 유지 | 상품 이미지, 첨부파일, 업로드 |
| channel-adapter | 유지, 외부 I/O 모의 | 주문 이벤트 발행, 수집 실패/재처리, 출고 채널 반영 시연 |
| analytics | 유지 | 관리자 매출·상품 통계와 기존 대시보드 유지; GA4 조회는 비활성 |
| notification | 유지, 전송 모의 | 이벤트→알림 이력 유지; 실제 수신자 전송 없음 |
| Medusa store/admin, storefront | 제외 | 소비자 구매 UI와 상거래 엔진 불필요 |
| wallet, wallet-web, membership, ugc-service | 제외 | 결제·멤버십·리뷰 시연 제외 |
| search, OpenSearch | 제외 | 별도 검색 서비스의 관리자 사용처는 쇼핑몰 검색어 통계; core 상품/SKU 조회는 유지 |
| Redis/Valkey | 제외 | 현재 배포의 주요 사용처는 Medusa; 남기는 서비스 부팅 검사로 의존성 제거 확인 |
| VPC, NAT, bastion, Redpanda, ALB, DB | demo 전용 유지 | live와 같은 네트워크·이벤트 구조, 데이터 분리 |
| CloudWatch 및 기존 관측 경로 | 유지 | stage/service 식별. 제거한 앱 scrape 대상과 불필요한 외부 분석 연동 정리 |
| warehouse-app | demo 빌드 배포 | SST 서버와 별개로 데스크톱/PDA 설치 산출물 제공 |

Bundle A는 analytics + channel-adapter, Bundle B는 notification만으로 구성할 수 있다. 앱 목록, `BUNDLE_APPS`, ALB target, 환경변수와 DB registry를 동일한 선택으로 맞춘다. 번들 이미지 빌드 최적화는 별도 후순위로 둔다.

제외 앱의 화면·메뉴·proxy는 명시적으로 비활성화한다. 환경변수를 비워 localhost fallback이나 존재하지 않는 URL 호출을 유발하지 않는다. 주문 취소는 실제 환불 없이 물류 취소까지만 처리하고, wallet 연동 설정을 주입하지 않는다.

## 5. 도메인·인프라·인증

| 주소 | 역할 |
| --- | --- |
| `admin.almondyoung-next.com` | 관리자와 `/demo` 콘솔 |
| `auth.almondyoung-next.com` | 로그인 UI |
| `user.almondyoung-next.com` | IdP/API, issuer, JWKS |
| `core.almondyoung-next.com` | 업무 API |
| `file.almondyoung-next.com` | 파일 API |
| `channel-adapter.almondyoung-next.com` | 채널 서비스 |
| `analytics.almondyoung-next.com` | 통계 서비스 |
| `notification.almondyoung-next.com` | 모의 알림 서비스 |

- 서울 리전, 기존 3-stack 구조를 유지한다. auth와 services DB는 각각 demo 전용 인스턴스이며 logical DB도 필요한 것만 생성한다.
- `isLive`/`isDemo`/도메인 루트/활성 서비스/외부 연동 모드를 분리한다. `NODE_ENV=production`은 demo에서도 유지한다.
- live와 기존 dev의 리소스 이름·도메인·설정은 보존한다. unknown stage가 demo 도메인을 가져가지 못하게 한다.
- SST Route 53 DNS adapter에 hosted zone을 명시할 수 있다. 인증서/DNS 소유자를 한 스택으로 정하고 기존 wildcard/명시 host의 우선순위를 유지한다.
- DB, Kafka, S3, OAuth 서명키, RP secret, 내부 서비스 키는 demo 전용이다. 운영 DB 복제나 운영 개인정보·외부 서비스 키 복사는 하지 않는다.
- user-service에 시연 관리자·창고 작업자, `admin-web` confidential client, `warehouse-app` public PKCE client와 실제 플랫폼별 callback을 등록한다. 창고 역할/범위도 시드한다.
- warehouse-app은 API URL뿐 아니라 issuer/authorize URL도 demo로 빌드한다. 앱 이름에 Demo를 표시하고 별도 앱 식별자/로컬 작업 저장소로 운영 앱과 공존하도록 한다. 스캔·출력·OAuth callback의 실제 장비 검증이 필요하다.
- 시연 중 쌓인 작업을 보존하도록 demo에도 `protect`를 켜는 안을 추천한다. 삭제 시 자원은 정리 가능한 정책을 유지하고, DB reset과 stack remove를 별도 절차로 구분한다.
- 기존 저용량 리소스 형태에서 시작하되 초기 데이터 적재와 여러 작업자 동시 시연 시 메모리·DB 연결을 측정한다. 정확한 비용은 최종 리소스 목록과 가동 시간을 정한 뒤 산정한다.

SST 공식 문서: [Custom Domains](https://sst.dev/docs/custom-domains), [Nextjs DNS 설정](https://sst.dev/docs/component/aws/nextjs). Route 53의 동일 계정 도메인 연결과 명시적 hosted zone 지정이 지원된다.

## 6. 외부 연동 모의 처리

아래 모드는 **신규 구현할 계약**이며 현재 이미 존재하는 환경변수로 간주하지 않는다. 제안 설정은 `APP_STAGE=demo`, `DEMO_CONSOLE_ENABLED=true`, `EXTERNAL_INTEGRATIONS_MODE=mock`이다. demo에서 real mode 또는 실제 외부 provider가 선택되면 부팅 시 거부한다.

| 경계 | demo 동작 |
| --- | --- |
| 주문 채널 | 가상 주문 provider가 기존 정규화/수집/typed outbox 경로로 데이터를 공급 |
| 채널 상품·재고·출고 반영 | demo 저장소에 요청/결과 기록, 실제 판매채널 HTTP 호출 없음 |
| 택배 | `CarrierGateway` 구현체를 demo 것으로 교체. 채번·등록·취소·조회 상태를 영속 보관 |
| 송장 출력 | 현재 formatter/scanner가 허용하는 번호와 label 데이터를 생성, 출력물에 시연용 표시 |
| SMS/알림톡/이메일 | 실제 sender 대신 모의 전송 결과와 본문을 기록. 콘솔에서 열람 |
| Cafe24·외부 회원 연동·사업자 조회 | 초기 공급 계정으로 로그인, 해당 연동 비활성/모의 처리 |
| GA4 등 외부 분석 | 실제 운영 속성에 접근하지 않고 시연 범위에서 제외 |

키를 빼서 실패시키는 것만으로 모의 처리라 하지 않는다. 정상 처리 결과를 만들고 작업 흐름이 이어지게 한다. 미배포 Medusa/membership/storefront를 호출하는 소비자·cron·재검증 요청도 비활성화한다. 내부 재고/이벤트/발주 집계 작업은 유지한다.

권한과 stage 검사를 서버에서 수행한다. demo API는 비-demo에서 등록하지 않으며, 콘솔은 demo 관리자만 사용한다. mock 송장은 같은 요청 재시도에 같은 번호를 돌려주고 실제 택배 접수를 시도하지 않는다.

## 7. demo 콘솔

위치: `apps/admin-web`의 `/demo`. 별도 웹 앱·로그인·도메인을 추가하지 않는다. 모든 업무 화면 상단에 DEMO 표시를 붙인다.

### 1차 기능

1. **시연 준비:** fixture 버전, 준비된 상품·SKU·공급사·창고·위치·바코드, 데이터 생성 상태, 최근 오류 확인.
2. **주문 생성:** 템플릿, 주문 수, 상품/수량, 재고 충분/부족 조건, 가상 고객 선택. 결과에서 주문 상세로 이동.
3. **시나리오 시작:** 정상 출고, 재고 부족→발주→입고 후 출고, 부분 입고, 적치/이동/실사, 매칭 실패→재처리.
4. **생성 이력:** run ID별 성공/진행/실패, 생성한 주문·문서 링크, 부분 실패 재시도.
5. **모의 외부 결과:** 송장/채널 반영/알림 기록과 필요 시 배송 상태 진행.

데이터 생성 실행 기록은 소유 서비스 DB에 영속화한다(최소 run ID, fixture 버전, 입력 hash, 결정적 seed, 실행자, 상태, 생성 ID, 실패 사유). 실행 키와 주문별 키를 고정해 더블클릭·타임아웃·재시도에 중복 생성하지 않는다. 완료 표시는 HTTP 접수와 구별하고 Core 주문/출고 연결 반영까지 확인한다.

주문 생성의 책임은 channel-adapter, 물류 fixture/업무 명령의 책임은 core, 화면/BFF의 책임은 admin-web에 둔다. 브라우저가 DB/Kafka/서비스 secret에 직접 접근하지 않는다.

### 처리 흐름

```text
admin-web /demo
  → 인증·권한·stage 검사 + 생성 run 기록
  → channel-adapter 가상 주문 provider
  → 기존 수집/정규화 → typed outbox → demo Kafka
  → core OrderCreated consumer
  → 판매주문 + 출고 생성 backlog → FO/shipment
  → 기존 예약·송장·피킹·검수·출고
  → analytics / 모의 채널 반영 / 모의 알림
```

가상 주문은 기존 지원 채널 계약을 사용하고 별도 run 식별자를 붙인다. 존재하지 않는 `salesChannel='demo'`를 enum에 임의로 넣지 않는다. 필요한 상품/variant/매칭과 판매채널 설정은 함께 준비한다.

## 8. 데이터 구성과 반복 시연

### 기준 데이터

초기 제안은 SKU 약 30개, 공급사 3개, 국내/해외 창고 2곳과 각 선반·입고 대기·불량·반품 위치다. 일반 상품, 복수 SKU 구성 상품, 재고 부족 상품, 매칭 대기 상품을 포함한다. 수량은 실제 시연 동선에 맞춰 조정할 수 있다.

기존 `db:bootstrap → db:migrate → db:seed:ref`를 재사용하고 `demo-logistics` 그룹을 추가한다. baseline seed도 필요한 서비스에 한정한다. 다른 제품의 demo-salon 시드와 기본 비밀번호를 가져오지 않는다.

### 과거 이력과 실시간 시연을 구분

- 발주 추천용으로 기본 365일의 합성 수요 이력을 준비한다. 안정적/간헐적/변동 수요와 공급사별 최소 5회 이상 납기 표본을 포함한다.
- 과거 이력이 모두 미출고 작업으로 생기지 않도록 fixture 전용 이력 경로를 사용한다. 주문·발주·입고 이력을 넣을 때 관련 상태와 참조를 일치시킨다.
- 이력 적재 후 기존 full 수요 재계산→프로필→납기 계산을 호출한다. 현재 14일 nightly window만으로는 365일 이력이 재계산되지 않는다.
- 현재 작업용 주문은 demo 전용의 고정 `FULFILLMENT_V2_CUTOVER_AT` 이후로 생성하며 `FULFILLMENT_WORKFLOW_MODE=v2`를 유지한다.
- 시연 중 재고 변경은 기존 입고/적치/이동/조정 명령을 사용한다. DB 수량만 수정해 원장·예약·출고 계획을 불일치하게 하지 않는다.

### 초기화

1차 콘솔은 새 run 추가와 템플릿 반복을 지원한다. 부분 생성 실패는 같은 run에서 재개한다. 취소/재고 복구는 기존 업무 명령을 이용한다.

전체 baseline 복원은 1차에서 운영자 CLI/runbook으로 제공한다. demo stage/DB 식별 확인, 작업 중단, producer/consumer 및 cron 정지, DB와 demo Kafka/inbox/outbox 처리 범위 정합성 확보, 기준 데이터 재적재 후 재개 순서를 포함한다. DB만 지우면 과거 이벤트가 다시 반영될 수 있으므로 금지한다. live 자원은 대상이 될 수 없게 한다.

## 9. 구현 순서와 완료 조건

| 단계 | 변경 범위 | 완료 기준 |
| --- | --- | --- |
| 1. 배포 프로필 | 공통 stage 설정, 3개 SST 앱, 리소스/시크릿/번들/출력/seed registry 조건부 생성 | demo만 새 자원 생성, live/dev 변경 없음, 제외 앱 자원·secret 요구 없음 |
| 2. 업무 경계 모의 처리 | channel-adapter, core CarrierGateway, notification, auth 외부 연동 | 정상 송장·채널·알림 결과 영속화, 실제 업무 외부 호출 0 |
| 3. 인증·초기 데이터 | demo 계정/권한/OAuth, demo-logistics, 상품/매칭/수요·납기 | admin/native 로그인, SKU 조회, 발주 추천·발주서 생성 가능 |
| 4. 콘솔 | admin-web /demo, demo API, run 기록/멱등성, 메뉴·proxy 기능 선택 | 주문 생성→Core 반영→FO/shipment 확인, 재시도 중복 0 |
| 5. 배포·장비 인수 | demo 3-stack 배포, DB 초기화, demo native 산출물 | 아래 전체 동선 성공, 재시작/재시도에도 재고 보존 |

의존 순서는 platform → auth → services다. 최초 DB 생성/마이그레이션 전에 앱이 정상 부팅하지 못할 수 있으므로 기존 bootstrap 경로를 확인하고, 인프라 준비와 앱 활성화 사이에 DB 초기화 단계를 둔다. 이후 배포는 migration 선행과 호환성을 검증한다. 배포와 시드에 항상 `--stage demo`와 해당 deployment를 명시한다.

인수 동선:

1. demo 관리자와 작업자로 각각 로그인.
2. 수요 이력 기반 발주 추천 → 발주서 확정.
3. 부분 입고 → 잔량 입고 → 적치 → 같은 창고 내 이동.
4. 콘솔 주문 생성 → 출고 작업 생성 → 모의 송장 발행·출력.
5. 실제 앱에서 위치별 피킹·검수·출고, 재고/예약/원장 대사.
6. 품절 주문에 보충 입고 후 출고 재개, 모의 알림·채널 처리 이력 확인.
7. 동일 생성 요청 재시도, 앱 재시작 및 응답 유실 복구에서 중복 주문/중복 출고 없음.
8. 비-demo에서 demo API 접근 불가, 운영 issuer/DB/bucket/외부 업무 endpoint 참조 없음.

자동 검증은 stage 설정과 mock 선택 규칙, 생성 멱등성, 실제 DB+Kafka 주문 흐름, core 업무 통합 검사, admin/native build에 집중한다. 실제 Windows/PDA·스캐너·프린터 인수는 별도로 기록한다. 이번 설계 조사에서는 테스트나 배포를 실행하지 않았다.

## 10. 범위 밖

실제 구매·결제·환불, 고객 회원가입 시연, 외부 판매채널 API 연결, 실제 택배 접수/알림 발송, live 데이터 복제, 고가용성 재설계, 콘솔의 임의 SQL 실행, 웹 버튼 한 번으로 전체 환경 파괴/복원, apex/기존 redirect 이전은 1차 범위 밖이다.

## 11. 주요 근거 파일

- `deployments/lcnine/{platform,auth,services}/sst.config.ts`
- `deployments/lcnine/auth/infra/{shared,services}.ts`
- `deployments/lcnine/services/infra/{shared,services}.ts`
- `deployments/lcnine/services/bundle/supervisor.mjs`
- `scripts/seeding/{seed-demo.ts,lib/service-registry.ts,phases/03-seed-orchestrator.ts}`
- `scripts/seeding/steps/replenishment.seed-step.ts`
- `apps/core/src/modules/sales-order/{services/sales-orders.service.ts,consumers/order-events.consumer.ts}`
- `apps/channel-adapter/src/services/order-collection/{channel-order-provider.interface.ts,order-poller.orchestrator.ts}`
- `apps/core/src/modules/fulfillment/waybill/carrier/{carrier-gateway.interface.ts,hanjin/carrier-gateway.factory.ts}`
- `apps/core/src/modules/inventory/replenishment/demand/{demand-series.writer.ts,replenishment-refresh.job.ts}`
- `apps/admin-web/src/lib/api/domains/{analytics,search}/index.ts`
- `native/warehouse-app/src/app/config.ts`, `native/warehouse-app/.env.local.example`

AWS 조회: `route53 list-hosted-zones-by-name`, `route53 list-resource-record-sets`, `cloudfront list-distributions`만 실행했다.
