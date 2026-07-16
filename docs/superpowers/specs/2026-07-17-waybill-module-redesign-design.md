# 운송장(waybill) 모듈 재설계 — 설계

- 날짜: 2026-07-17
- 상태: 초안 (리뷰 대기)
- 범위: 백엔드 (`apps/core` fulfillment)
- 스키마 마이그레이션: 있음 (invoice 계열 → waybill 계열 교체; 실 데이터 없음 → 파괴적 교체 무해)
- Supersedes: `docs/superpowers/specs/2026-07-16-manual-self-invoice-issuance-design.md` (self 경로는 이미 develop 머지·동작 중 → 본 재설계로 계승·정식화)

## 1. 배경 / 문제

Core의 송장(invoice) 레이어는 **굿스플로 계약에 맞춰** 설계된 비동기 durable saga(`InvoiceOrchestrator`, 1,392줄 + `InvoiceRecoveryWorker` 10초 크론)다. 굿스플로를 더 이상 쓰지 않기로 했고, **이 시스템에서 자동 발급으로 송장을 발급한 적이 한 번도 없다**(현재 유일하게 뚫린 경로는 어제 머지된 `self` 수동 입력뿐). 즉 invoice 부분은 실 데이터·마이그레이션 부담 없이 백지에서 재구축 가능하다.

한진택배 OpenAPI 스펙 5종(`/home/pauseb/docs/hanjin/*.yaml`)을 검토한 결과, 굿스플로용 구조가 한진과 근본적으로 맞지 않는다:

- **발급이 단일 호출이 아니라 2단계·2호스트**: `print-wbl`(채번+분류정보, host `ebbapd.hjt.co.kr`) → `insert-order`(주문등록, host `api-stg.hanjin.com`). 등록 호출은 번호도 service id도 반환하지 않는다(운송장번호는 채번 단계에서 나옴).
- **provider service id 개념 없음**: 상관키는 우리가 만든 `custOrdNo` + `wblNo`.
- **라벨 URL 없음**: `print-wbl`이 분류 원시필드(터미널/집배점/배송사원)를 주고, 라벨은 우리가 직접 렌더·인쇄한다(원래부터 전용 프린터로 100장 일괄 인쇄해 온 방식과 일치). 굿스플로식 `printUri`는 방해만 되던 기능이라 폐기.
- **멱등 앵커가 다름**: 굿스플로는 멱등키가 없어 무거운 사가를 강요했지만, 한진은 `insert-order`가 `wblNo` 중복을 ERROR-09로 막아 **자연 멱등 앵커**를 제공한다(S-flow는 `custOrdNo` 중복은 미검사).

동시에, 나중에 다른 택배사·자체 송장(자체배송)으로 확장할 가능성이 있으므로 **한진에 완전히 lock-in되는 구조는 피한다**(굿스플로 폐기가 남긴 교훈).

## 2. 목표 / 비목표

**목표**
- 굿스플로용 invoice/provider 레이어를 제거하고, self-print 캐리어(한진)에 맞는 **waybill 모듈**을 신설.
- 운송장번호 + 라벨/분류필드까지 **데이터로** 제공(렌더링·프린터 전송은 별도 관심사). 배치 N건 일괄 반환.
- **경량 상태머신**으로 크래시 안전한 발급(중복 등록·번호 유실 방지). 무거운 operation-log/lease/리커버리 워커 없음.
- **캐리어 추상 포트**로 lock-in 회피(한진 어댑터만 지금 구현, self/타캐리어는 인터페이스만 개방).
- 이미 develop에 살아있는 `self` 수동 입력 경로를 새 모듈의 1급 영구 기능으로 계승.
- 기존 outbound 소비자(피킹/디스패치/리콜/short-pick/배치) seam을 보존해 흐름 로직 재작성 없이 주입만 교체.

**비목표 (out of scope)**
- 배송추적 폴러 (포트에 `track()` 캡빌리티만 노출; 한진 pull → 기존 push sink `ShipmentDeliveryTrackingService`로 먹이는 폴러는 후속).
- 라벨 렌더링/프린터 드라이버 (admin-web 등 별도 관심사).
- self/타캐리어 어댑터 본체 (인터페이스만).
- 한진 `cancel-order`(예약 취소) — S-flow는 발급 시 이미 출력 상태라 무의미.
- admin-web UI.

## 3. 결정 사항 (확정)

| # | 결정 | 근거 |
|---|------|------|
| 모듈 경계 | 운송장번호 + 구조화된 라벨/분류필드까지만. 렌더링·인쇄 별도. printUri 폐기. 배치 N건 일괄 | 전용 프린터 직접 인쇄(100장 일괄)가 원래 방식; 한진 self-print와 합치 |
| 크래시 안전성 | 경량 상태머신 (`waybills` 1테이블 + `drive()` 하나). wblNo UNIQUE + ERROR-09=성공. operation-log/lease/리커버리 워커 없음 | 한진 wblNo 자연 멱등 앵커가 무거운 사가를 불필요하게 함 |
| 캐리어 seam | 안 A — 2-step capability 포트(`allocate`/`register`). 크래시 안전성은 머신에 집중, 어댑터는 얇게. labelData는 carrier-tagged blob | 상태머신과 1:1, self/1-phase 캐리어 무마찰, 한진 필드가 포트에 안 샘 |
| 캐리어 범위 | 한진 어댑터만 지금 구현. self/타캐리어는 인터페이스만 | YAGNI |
| void | 로컬 void + 재발급. cancel-order 미구현 | 한진 S-flow는 API 취소 없음 |
| 교착 해소 | `abandoned` 종료상태 신설. `pending` 포기=attempts CAP 자동/운영자(안전), `allocated` 포기=운영자 전용(이중등록 위험 인지+wblNo 기록) | stuck pending/allocated가 활성 슬롯 영구 점유 방지; allocated 자동 포기는 이중등록 재발 위험이라 금지 |
| tracking | 포트에 `track()` 캡빌리티만. 폴러는 후속 | 발급 라이프사이클에 집중 |
| 정명 | `invoice` → `waybill`. 오케스트레이터·워커·provider·굿스플로/한진 스텁·`invoiceOperations` 삭제 | 송장(세금계산서)과 혼동 제거, 백지 재구축 |
| self 계승 | dispatch-gate self 완화·void 발송전 안전범위·`assertProfileComplete` 미적용을 새 모듈로 이관 | 이미 develop 동작 중, 회귀 금지 |
| 에러/레이어 | 새 모듈은 CLAUDE.md 정식 레이어(Controller→Service→Manager/Reader→Repository) + `@app/shared` 예외 준수 | 오케스트레이터의 ad-hoc `conflict()` 스타일은 계승 안 함(신규 모듈) |

### 3.1 착수 전 미정사항 해소 (2026-07-17 확정 — 브레인스토밍)

플랜 2 착수 전 열려 있던 4개 항목(구 §16 착수 전제)을 아래로 확정한다.

1. **custOrdNo 파생규칙** — `'AY' + Crockford-base32(shipmentId의 16 UUID 바이트)` = 28자(≤30B). 결정적(재구동 시 동일값)·shipment와 1:1 유일(UUID 전단사)·분할배송에도 shipment별 고유. `waybills.custOrdNo`에 저장하고 대사는 저장값으로 조회(정산 실키는 wblNo=trackingNo). `AY` prefix는 한진 포털 식별용(장식적). 한진이 custOrdNo를 멱등 검사에 쓰지 않으므로(멱등 앵커는 wblNo UNIQUE + 행내 재구동) 유일성은 우리 대사 편의일 뿐.
2. **송하인 + 박스/지불조건 소스** — `HanjinConfig`(`loadHanjinConfig`, 플랜 1 완료)가 이미 `sender{name,zip,baseAddress,detailAddress,tel}`·`boxType`(기본 `'A'`)·`payType`(기본 `'PP'`)를 `HANJIN_SENDER_*`/`HANJIN_BOX_TYPE`/`HANJIN_PAY_TYPE` env에서 로드. 플랜 2 조립부는 `config.sender/boxType/payType`을 그대로 소비(신규 config 없음). **단일 송하인 가정**(YAGNI); per-shipment 박스/지불 오버라이드 미도입; 다창고별 송하인은 후속(`warehouses` 확장, §17).
3. **markUsed 계약** — `markUsed(shipmentId, tx?)`가 `registered → used` 전이를 캡슐화. 디스패치는 `invoices/waybills` 직접 write를 중단하고 dispatch tx 안에서 이 메서드를 호출(tx 전파). **멱등**(used→used no-op) + **엄격**: `status IN {registered, used}` 조건부 업데이트 후 활성 waybill 정확히 1행 영향이 아니면 도메인 예외(불변식 위반; `assertDispatchable`이 흐름을 선행 게이트). 구 `shipment-dispatch.service.ts`의 `invoices.status='used'` 직접 갱신을 대체.
4. **스테이징 스모크 범위** — 테스트 서버가 dev key로 접근 가능. 플랜 2에 스모크 태스크 포함: `insert-order`+`tracking` body 매핑을 order 호스트(`api-stg.hanjin.com`)에 실검증. `print-wbl`(`ebbapd.hjt.co.kr`)은 dev key + 방화벽 IP 화이트리스트가 그 호스트를 커버하는지 착수 시 확인; 미커버면 print-wbl body는 문서 기반 + `smoke-pending` 게이트 + 리스크 플래그. 라이브 자격증명은 개발 완료 후 별건(플랜 2/3 범위 밖).

## 4. 아키텍처 개요

위치: `apps/core/src/modules/fulfillment/waybill/`. `WaybillModule`을 `FulfillmentModule`이 import, `WaybillService` export.

```
WaybillController
   └─ WaybillService (port; 2~3줄 비즈니스 흐름, @app/shared 예외)
        ├─ WaybillIssueMachine   (drive(): pending→allocated→registered 멱등 전이 · 크래시 안전성 집중)
        ├─ WaybillManager        (검증 + 발급/void/재발급 쓰기 · manifest/recipient 가드)
        ├─ WaybillReader         (read-model: getActiveWaybill / assertDispatchable)
        └─ CarrierGateway (추상 포트)
               └─ HanjinCarrierGateway
                      ├─ HanjinApiClient   (HTTP + 재시도 · 두 호스트)
                      └─ HanjinHmacSigner   (서명 · 순수/유닛테스트)
```

- 멱등 재제출 방어는 기존 `FulfillmentCommandService.commands.execute`(=`fulfillment_command_requests`, `idempotency-key` 헤더) 재사용.
- 트랜잭션 전파는 ADR-0025 `DbService.run` + `DbTx`(inventory) 규약 준수.

## 5. 엔티티 / 스키마

`inventory.schema.ts`에서 `invoices`·`invoiceOperations` 정의를 **삭제**하고 `waybills`로 교체. 관련 enum 재정의.

### 5.1 enum

```ts
// 삭제: invoiceStatusEnum, invoiceMethodEnum, invoiceOperationTypeEnum
export const waybillStatusEnum = pgEnum('waybill_status', [
  // 활성(슬롯 점유)
  'pending',     // 행 생성, 외부 호출 전 (carrier 발급만; manual은 안 거침)
  'allocated',   // 채번 완료(print-wbl), wblNo·labelData 저장 — 등록 전 (carrier 전용, transient)
  'registered',  // 등록 완료(insert-order/already_registered) 또는 manual 수동 입력 — 디스패치 가능
  'used',        // 디스패치(출고)로 소비됨 — 기존 'used' 의미 유지(디스패치 흐름이 전이)
  // 종료(슬롯 해제)
  'voided',      // registered 를 발송 전 취소 (로컬, 번호 판기)
  'failed',      // 캐리어 확정 거절(rejected) — 재시도 무의미
  'abandoned',   // 미상 결과(unknown_outcome) 지속으로 발급 포기. pending: attempts CAP 자동/운영자(안전).
                 //   allocated: 운영자 전용(이중등록 위험 인지 + 미해결 wblNo 기록)
]);
export const waybillSourceEnum = pgEnum('waybill_source', ['carrier', 'manual']);
// carrier = 캐리어 API 채번(현재 한진), manual = 운영자 외부번호 수동 입력(구 'self')
```

### 5.2 `waybills` 테이블

| 컬럼 | 타입 | 비고 |
|------|------|------|
| `id` | uuid pk | |
| `shipmentId` | uuid → shipments, restrict, notNull | 소유 |
| `source` | waybillSourceEnum notNull | carrier / manual |
| `carrier` | carrierEnum notNull | HANJIN 등 (기존 enum 재사용) |
| `status` | waybillStatusEnum notNull default 'pending' | manual은 'registered'로 바로 insert |
| `trackingNo` | varchar(128) | 운송장번호(wblNo). **allocated 이후 not-null + UNIQUE**. pending 단계엔 null |
| `custOrdNo` | varchar(30) | 한진 상관키(주문번호). `'AY'+Crockford-base32(shipmentId 16B)`=28자(§3.1-1). carrier 발급 시 채움 |
| `labelData` | jsonb | **carrier-tagged blob**. 한진 print-wbl 분류필드(터미널/집배점/배송사원/prt_add 등). manual은 null |
| `manifestVersion` | integer notNull | 발급 시점 shipment manifest 버전(낙관적 정합) |
| `recipientHash` | varchar(64) notNull | 발급 시점 수취인 스냅샷 해시(`canonicalShipmentRecipientHash`) |
| `lastError` | text | failed/재시도 컨텍스트 |
| `attempts` | integer notNull default 0 | drive() 재구동 횟수(관측용; lease 아님) |
| `issuedAt` | timestamptz | registered 전이 시각 |
| `voidedAt` | timestamptz | |
| `createdAt`/`updatedAt` | timestamptz | |

**제약**
- `trackingNo` 부분 UNIQUE (`WHERE trackingNo IS NOT NULL AND status NOT IN ('voided','failed','abandoned')`) — **live 운송장 사이에서만** 유일. 멱등 앵커(재구동 시 동일 wblNo 재삽입 차단, ERROR-09와 양면 보장)이면서, 오void한 manual 번호 재등록은 허용(§11·#3). carrier 멱등은 행 내 재구동에 앵커하므로 종료 상태 제외가 안전.
- 활성 유니크: `uniqueIndex uq_waybills_shipment_active ON (shipmentId) WHERE status NOT IN ('voided','failed','abandoned')` — shipment당 활성 운송장 1개. 종료 3상태 모두 슬롯 해제(교착 방지).
- check: `status IN ('allocated','registered','used') → trackingNo IS NOT NULL`.
- check: `source = 'manual' → status IN ('registered','used','voided')` (manual은 외부 호출이 없어 pending/allocated/failed/abandoned 를 거치지 않음).

### 5.3 마이그레이션

실 데이터가 없으므로 파괴적 교체가 무해: `invoices`·`invoiceOperations` DROP, `waybills` + enum CREATE. ADR-0005 expand-contract 예외(데이터 없음). `db:generate:core -- --name replace-invoices-with-waybills` 로 생성, 스키마+SQL+meta 한 커밋.

## 6. 캐리어 포트 (`carrier-gateway.interface.ts`)

```ts
export abstract class CarrierGateway {
  abstract readonly carrier: CarrierEnum;
  abstract readonly capabilities: {
    allocatesExternally: boolean;   // 한진 true (print-wbl) / 자체 false
    registersSeparately: boolean;   // 한진 true (insert-order) / 1-phase·자체 false
    canTrack: boolean;
    canCancel: boolean;
  };
  // 채번 + 라벨/분류데이터. 자체배송이면 로컬 채번.
  abstract allocate(req: WaybillRequest): Promise<AllocateResult>;   // { waybillNo, labelData }
  // 등록. 한진 insert-order. 1-phase/자체는 no-op. ERROR-09 등은 outcome으로 정규화.
  abstract register(waybillNo: string, req: WaybillRequest): Promise<RegisterOutcome>;
  track?(waybillNo: string): Promise<CarrierScan[]>;
  cancel?(waybillNo: string, req: WaybillRequest): Promise<void>;
}
```

정규화 결과·에러:

```ts
type RegisterOutcome =
  | { kind: 'registered' }               // OK
  | { kind: 'already_registered' }       // 한진 ERROR-09 → 멱등 성공 신호
  | { kind: 'rejected'; reason: string } // 확정 거절(주소/계약 등) → failed
type CarrierError = { outcome: 'definitive_rejection' | 'unknown_outcome'; code?: string; cause?: unknown };
```

- `unknown_outcome`(타임아웃 등)만 "부작용이 일어났을 수 있음"을 의미 → 상태머신이 재구동으로 처리.
- `WaybillRequest`는 캐리어 중립: 수취인(우편번호/기본주소/상세주소 분리)·송하인·품목리스트·박스/지불조건·계약번호·custOrdNo. 한진 필수필드를 모두 담도록 구성(구 `DeliveryRequest`엔 우편번호/분리주소/박스/지불조건이 없어 부족했음).

## 7. 한진 어댑터 (`hanjin-carrier.gateway.ts`)

### 7.1 인증 — `HanjinHmacSigner` (공식 가이드 확보 완료)

```
timestamp = yyyyMMddHHmmss (Asia/Seoul)
message   = timestamp + METHOD + queryString + secretKey     // queryString = URL '?' 뒤 원문, POST면 ''
signature = HMAC_SHA256(message, key=secretKey) → hex 소문자
headers:
  Content-Type: application/json
  x-api-key:    {API Key}
  Authorization: client_id={clientId} timestamp={timestamp} signature={signature}   // 공백 구분
```
- **소문자 hex**(공식 Java/CryptoJS 기준; 스펙 예시의 대문자는 문서 표기 오류).
- body는 서명에 미포함(한진 설계). queryString이 서명에 들어가므로 **HTTP 호출 계층에서 실제 나가는 URL로** 서명.
- 자격증명 3개: `HANJIN_CLIENT_ID`(EDI), `HANJIN_API_KEY`(x-api-key), `HANJIN_SECRET_KEY`(HMAC). timestamp/서명은 매 요청 새로 생성.
- signer는 순수·주입가능. dev 스모크로 `/v1/util/hmacgen` 반환 서명과 1회 대사(선택적 회귀가드).

### 7.2 operation 매핑

| 포트 | 한진 | host | 반환 |
|------|------|------|------|
| `allocate` | `POST /v1/wbl/{client_id}/print-wbl` | `ebbapd.hjt.co.kr` | `wbl_num` + 분류필드 → labelData |
| `register` | `POST /parcel-delivery/v1/order/insert-order` | `api-stg.hanjin.com` | resultCode(OK/ERROR-09/거절) |
| `track` | `POST /parcel-delivery/v1/tracking/tracking-wbl(s)` | `api-stg.hanjin.com` | wrkList(statusCode) |
| (health) | `GET /parcel-delivery/v1/customer/customer-check` | `api-stg.hanjin.com` | 계약 유효성 → `isConfigured()` |

**insert-order 필드 매핑(요지)**: `custEdiCd`←clientId, `custOrdNo`←파생, `wblNo`←allocate 결과, `svcCatCd='S'`(자체출력), `cntractNo`←config, `pickupAskDt`←오늘(KST), 송하인(sndr*)←창고 주소/config, 수하인(rcvr*)←shipment recipientSnapshot(우편번호/기본·상세주소 분리), `comodityNm`/`comodityList`←manifest 라인, `boxTypCd`/`payTypCd`←config 기본값.

**에러 정규화**: `resultCode` OK→registered, ERROR-09(기등록)→already_registered(멱등 성공), ERROR-05/06/기타 확정→rejected/definitive_rejection, HTTP 타임아웃/5xx→unknown_outcome.

**track statusCode→상태 매핑**: 01/05 등록·출력→pending, 07/11/31/32/63→in_transit, 66→delivered, 92→failed, 03→canceled.

### 7.3 설정

두 base URL·계약번호·자격증명은 SST Secret + `env.validation.ts`. 스테이징/운영 분리. `isConfigured()`는 env 존재가 아니라 **customer-check 성공**으로 판정(구 스텁의 무조건 false 대체).

## 8. 발급 상태머신 (`WaybillIssueMachine.drive`)

```
pending    --allocate OK----------->  allocated   (wbl_num·labelData durable 저장; trackingNo UNIQUE)
pending    --allocate rejected----->  failed
pending    --unknown_outcome------->  pending     (attempts++, 재구동)
pending    --attempts≥CAP(unknown)->  abandoned   (자동, 안전) ── 운영자 포기도 가능
allocated  --register OK/ERROR-09-->  registered  (already_registered = 멱등 성공)
allocated  --register rejected----->  failed
allocated  --unknown_outcome------->  allocated   (attempts++, 동일 wblNo 재구동 — 자동 포기 금지)
allocated  --운영자 포기----------->  abandoned   (운영자 전용; 미해결 wblNo 기록 + 이중등록 경고)
registered --markUsed(dispatch)---->  used
registered --void(발송 전)--------->  voided
registered/used/voided/failed/abandoned --> no-op (멱등)
```

**핵심 불변식**: `allocate`로 받은 `wblNo`를 `register` **전에 durable 저장**(allocated 전이), 재구동은 **항상 저장된 동일 wblNo로** `register` 재시도, `already_registered`(ERROR-09)를 성공으로 처리. ⇒ 타임아웃으로 응답만 유실돼도 이중 등록 없음(한진 custOrdNo 미검사 quirk를 우회).

**포기(교착 해소)의 비대칭 — 불변식 유지의 핵심:**
- **`pending` 포기는 안전 → 자동 허용.** allocate만 실패한 상태라 wblNo 없음·insert-order 미발송. 재발급하면 새 번호로 딱 한 건 등록됨(원래 print-wbl이 몰래 채번했더라도 미사용 누수 번호일 뿐, 이중 *배송* 없음). `attempts ≥ CAP`(config 상수, unknown_outcome 지속 시) → `abandoned` 자동 전이. 운영자 수동 포기도 가능.
- **`allocated` 포기는 자동 금지 → 운영자 전용.** wblNo W 보유 + insert-order(W)가 unknown_outcome이면 **Hanjin이 W로 이미 등록했을 수 있음**. 자동으로 슬롯을 놓고 새 번호로 재발급하면 이중등록/이중집하 위험(custOrdNo 미검사). 게다가 tracking-wbl(W)는 스캔 전 ERROR-01이라 "등록됨/미등록" 구분 불가. 따라서 **CAP 미적용**(`allocated`는 attempts 무제한, 동일 W로 계속 재구동해 ERROR-09로 등록 확인이 정상 해소). 포기는 오직 운영자가 이중등록 위험을 인지한 명시 액션으로만 `abandoned` 전이하고, 미해결 wblNo + 경고를 감사로그에 기록(정산 대상).

- 재시도 = `drive()` 재호출(같은 코드 경로). 각 전이는 저장 상태 + trackingNo UNIQUE로 가드.
- **stuck 재구동**: `pending`/`allocated`로 오래 멈춘 행을 찾아 `drive()` 재호출 — 별도 리커버리 워커 없이 관리 액션 또는 경량 스케줄. (정상 발급과 동일 경로)
- **한진 내재 한계(문서화)**: `print-wbl` 자체 타임아웃 시 번호가 채번됐는지 조회 API가 없어 재호출 시 새 번호가 나감 → 번호 누수 + 일일 한도(ERROR-05) 소모. correctness(이중등록)는 막지만 print-wbl 누수는 제거 불가. 누수/한도는 관측·정산으로 대응.

## 9. 서비스 / 컨트롤러 인터페이스

### 9.1 `WaybillService` (보존 seam)

| 메서드 | 대체 대상 | 소비자 |
|--------|-----------|--------|
| `issueForShipment(shipmentId, opts, idemKey, actor, tx?)` | `issueForShipment` | 피킹 전략, 컨트롤러 |
| `issueBatch(shipmentIds[], opts, idemKey, actor)` | (신규; print-wbls 배치) | 배치 오케스트레이터 |
| `registerManual(shipmentId, {carrier, trackingNo, ...}, idemKey, actor, tx?)` | `issueManualInvoice` (self 계승) | 컨트롤러 |
| `void(shipmentId|waybillId, {reason}, idemKey, actor, tx?)` | `void`/`voidManualInvoice` 통합 | 리콜, short-pick, 컨트롤러 |
| `reissue(shipmentId, opts, idemKey, actor, tx?)` | (신규; void→새 발급 원자화) | 컨트롤러 |
| `assertDispatchable(shipmentId, tx?)` | `assertDispatchableInvoice` | 디스패치, 피킹, 배치 |
| `markUsed(shipmentId, tx?)` | dispatch의 invoices.status 직접 갱신 | 디스패치(출고 확정) |
| `getActiveWaybill(shipmentId, tx?)` | invoices 직접쿼리 | 디스패치/플래닝/invariant/consolidation |

- `issueForShipment`/`issueBatch`는 waybill 행을 `pending`으로 durable 생성한 뒤 `drive()`를 **요청 내 동기 실행**(carrier 발급 = print-wbl→insert-order 2-call), 결과는 registered 또는 failed. durable `pending` 행 덕분에 요청이 중간에 끊겨도 stuck 재구동으로 복구 가능. 대량 배치는 §10대로 청크·건별 결과.
- `markUsed(shipmentId, tx)`: 디스패치(출고 확정) 흐름이 `registered → used` 전이를 이 메서드로 호출(테이블 직접 write 금지 — 전이를 모듈 안에 캡슐화). 구 코드가 dispatch에서 invoices.status를 직접 갱신하던 지점을 이 호출로 치환. **멱등**(used→used no-op) + **엄격**(status∈{registered,used} 조건부 업데이트, 활성 waybill 정확히 1행 아니면 도메인 예외 — §3.1-3).
- `registerManual`: source='manual'로 `registered` 즉시 insert(외부 호출 없음). 계승 가드: manifest/recipient 완비 + line identity만, **`assertProfileComplete`(구 goodsflow center code) 미적용**.
- `assertDispatchable`: 활성 waybill 1개 + `status ∈ {registered, used}` + carrier 존재 + trackingNo non-empty + manifest/recipient hash 일치. **externalServiceId 요구 폐지**(한진엔 provider service id 없음; source 무관 동일 가드). — 구 `issueMethod !== 'self'` 분기가 사라지고 통일됨.

### 9.2 `WaybillController`

| 라우트 | 핸들러 | 응답 | 스코프 |
|--------|--------|------|--------|
| `POST /shipments/:id/waybills` | 캐리어 발급 | 201 | WAREHOUSE_OPERATE |
| `POST /shipments/:id/waybills/manual` | 수동 등록(계승) | 201 | WAREHOUSE_OPERATE |
| `POST /waybills:batch` | 배치 발급 | 200 (건별 결과) | WAREHOUSE_OPERATE |
| `POST /waybills/:id/void` | void | 200 | SHIPMENT_REOPEN |
| `POST /shipments/:id/waybills/reissue` | void+재발급 | 201 | WAREHOUSE_OPERATE |
| `GET /shipments/:id/waybill` | 조회 | 200 | 조회 스코프 |

모든 쓰기 라우트 `idempotency-key` 헤더 필수(`commands.execute` 계약). 컨트롤러는 try/catch 없이 위임(전역 필터가 상태 매핑).

## 10. 배치 / 부분실패 처리

- `issueBatch`는 shipment별 `waybills` 행을 먼저 `pending`으로 **durable 생성**(부분실패 착지점 확보) → 한진 `print-wbls`(최대 100건)로 채번 → 건별 `wbl_num` 저장(allocated) → 건별 `insert-order`(register).
- 응답은 **건별 결과**(shipmentId → registered/failed/pending/사유). 실패 건은 waybill 행에 `failed`/`lastError`로, 미완 건은 `pending`/`allocated`로 남아, 성공 건 재채번 없이 미완 건만 재구동 가능.
- 100건 초과는 청크 분할. 일일 한도(ERROR-05) 도달 시 남은 건 `pending` 유지 + 사유 로깅(silent truncation 금지).
- **동기 실행 시간 리스크(#2)**: 100건 배치 = print-wbls 1콜 + insert-order 최대 100콜을 한 HTTP 요청에서 처리 → 게이트웨이/LB 타임아웃(예 ALB 60s) 가능. durable 행이 correctness는 보장하나, **insert-order bounded 병렬(동시 N) + 시간예산 초과 시 미완 건을 `pending`/`allocated`로 조기 반환(→ stuck 재구동/폴로 마감)** 또는 동기 배치 크기 상한 중 하나를 **구현 플랜에서 확정**. 상세 정책은 플랜 소관.

## 11. 재발급 / void 라이프사이클

- **void**: `registered`(발송 전) → `voided` + voidedAt. 외부 호출 없음(번호 판기). `used`(디스패치됨)·shipment `shipped/in_transit/delivered`면 거부(`WAYBILL_ALREADY_DISPATCHED`). 종료 상태라 활성 유니크가 풀려 재발급 가능.
- **abandon**(§8): 교착 해소용 포기. `pending`은 attempts CAP로 **자동**(또는 운영자), `allocated`는 **운영자 전용**(이중등록 위험 인지 + 미해결 wblNo 기록). → `abandoned`. void와 마찬가지로 활성 슬롯을 해제해 재발급 경로를 연다.
- **reissue**: 현재 활성 행을 void/abandon 후 새 발급을 **한 명령**으로. 시작점은 `registered`(주소 변경 stale·오채번 정정) 또는 `pending`/`allocated`(교착) 모두 가능. `allocated`발 reissue는 abandon의 운영자-전용·위험기록 규칙을 그대로 적용.
- **stale 감지**: `assertDispatchable`이 저장 해시 vs 현재 shipment 비교(`SHIPMENT_INVOICE_STALE` 계승). 별도 `recovery_required` 상태 없이 파생 — stale이면 운영자가 reissue.

## 12. Consumer seam 마이그레이션

`InvoiceOrchestrator` 주입 소비자 → `WaybillService` 주입 교체 + 메서드명 매핑(§9.1). `wmsTables.invoices` 직접쿼리 → `getActiveWaybill`/read-model 치환. forwardRef는 기존과 동일 지점 유지(shipment-recall, shipment-short-pick).

대상: `shipment-dispatch.service.ts`, `shipment-recall.service.ts`, `shipment-short-pick.service.ts`, `outbound-batch-orchestrator.service.ts`, `picking/{discrete,aggregate-then-sort,pick-to-tote}.strategy.ts`, `controllers/shipment-invoice.controller.ts`(→ WaybillController), `fulfillment.module.ts`. `fulfillment-invariant.service.ts`·`consolidation.service.ts`·`shipment-planning.service.ts`의 invoices 읽기 치환.

## 13. 에러 처리

새 모듈은 `@app/shared` 예외(`NotFoundError`/`BadRequestError`/`ConflictError`) + 전역 필터. 소비자/운영이 의존하던 오류 코드 의미는 보존(`SHIPMENT_INVOICE_NOT_READY`, `SHIPMENT_INVOICE_STALE`, 중복 trackingNo → `WAYBILL_TRACKING_ALREADY_EXISTS`, dispatch 후 void → `WAYBILL_ALREADY_DISPATCHED`).

## 14. 테스트 계획

- **HanjinHmacSigner (유닛)**: 공식 예제 입력 → 예제 서명 소문자 hex 재현. GET(쿼리 포함)/POST(빈 쿼리) message 조합. KST timestamp.
- **HanjinCarrierGateway (유닛, HTTP mock)**: allocate/register/track 필드 매핑; resultCode 정규화(OK/ERROR-09→already/거절/타임아웃→unknown).
- **WaybillIssueMachine (통합)**: pending→allocated→registered happy; register 타임아웃 후 재구동이 동일 wblNo로 재시도해 already_registered→성공(이중등록 없음); allocate 후 크래시→재구동; rejected→failed.
- **교착 해소 비대칭(핵심 회귀)**: `pending`에서 allocate unknown_outcome가 CAP 도달 → `abandoned` **자동** 전이, 이후 reissue 성공(이중배송 없음); `allocated`에서 register unknown_outcome 반복은 **자동 abandoned 안 됨**(attempts 무제한, 동일 wblNo 재구동 지속); `allocated` 운영자 abandon만 `abandoned` + 미해결 wblNo·경고 기록; 종료 3상태(voided/failed/abandoned)가 활성 슬롯 해제해 재발급 가능.
- **trackingNo 유니크(#3)**: live 두 행 동일 trackingNo 거부; manual `registered`→`voided` 후 **같은 번호 재등록 성공**(voided 제외 확인).
- **WaybillService**: registerManual(source='manual', registered 즉시, assertProfileComplete 미적용, carrierAccountRef 없는 프로필도 성공); void 발송전만; reissue 정정(registered발·allocated발); 중복 trackingNo 거부.
- **assertDispatchable (회귀)**: registered+carrier+trackingNo+hash 일치→통과; manual/carrier 동일 가드(externalServiceId 폐지 확인); stale→거부.
- **배치**: print-wbls 부분실패 → 성공 건 registered·실패 건 failed, 실패 건만 재구동.
- **소비자 seam**: 디스패치·리콜·short-pick·배치·피킹이 WaybillService로 정상 동작(기존 통합 시나리오 이관).

## 15. 파일 변경 목록 (요지)

| 구분 | 변경 |
|------|------|
| 삭제 | `invoice-orchestrator.service.ts`, `invoice-recovery.worker.ts`, `delivery-provider.interface.ts`, `goodsflow-delivery.provider.ts`, `hanjin-delivery.provider.ts`, `dto/shipment-invoice.dto.ts`, `controllers/shipment-invoice.controller.ts` + 각 spec |
| 스키마 | `inventory.schema.ts`: `invoices`/`invoiceOperations`/invoice enum 삭제, `waybills`/waybill enum 추가 + 마이그레이션 |
| 신규 `waybill/` | `waybill.module.ts`, `waybill.service.ts`, `waybill.manager.ts`, `waybill.reader.ts`, `waybill-issue.machine.ts`, `dto/*`, `controllers/waybill.controller.ts`, `carrier/carrier-gateway.interface.ts`, `carrier/hanjin/{hanjin-carrier.gateway,hanjin-api.client,hanjin-hmac.signer}.ts` |
| 소비자 수정 | §12 목록(주입·메서드·읽기 치환) |
| 설정 | `env.validation.ts`: goodsflow 제거, HANJIN_* + 두 host + 계약번호 추가 |

## 16. 리스크 / 유의 / 착수 전제

- **착수 전 확보 필요(스펙에 없음)**: 운영 URL, 운영 인증키(client_id/api key/secret key), 운송장 **채번규칙**(전용 대역), 일일 한도/레이트리밋 수치, `print-wbl` 운영 **방화벽 IP 등록**. HMAC 알고리즘은 확보 완료(§7.1). 이들 없으면 어댑터를 운영에서 못 쓴다 → 스테이징으로 구현·검증하고 운영값은 배포 시 주입.
- **print-wbl 번호 누수/한도**: §8 내재 한계. 관측·정산 필요.
- ✅ **custOrdNo 파생 규칙**: `'AY'+Crockford-base32(shipmentId 16B)`로 확정 (§3.1-1).
- ✅ **박스/지불조건·송하인 소스**: `HanjinConfig`(env) 단일 송하인으로 확정 (§3.1-2).
- **staging 스모크**: order 호스트(`api-stg.hanjin.com`)는 dev key로 실검증, `print-wbl`은 방화벽 IP 커버 확인 필요 (§3.1-4).
- **소비자 seam 교체 폭이 넓음**(9개 파일) — 기존 통합 테스트로 회귀 고정.

## 17. 후속 (별도 설계)

- 배송추적 폴러(한진 pull → `ShipmentDeliveryTrackingService` push sink 피딩).
- self/타캐리어 어댑터 본체, 자체배송 채번.
- 라벨 렌더링/프린터 파이프라인(labelData → 물리 라벨).
