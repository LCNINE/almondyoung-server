# lcnine-services 경량 서비스 번들 통합 설계

- 작성일: 2026-07-04
- 목적: AWS 비용 절감. 트래픽이 적은 6개 백엔드 서비스의 HTTP 어댑터를 Fastify로 통일한 뒤, 하나의 Fargate 태스크에 통합 호스팅한다.
- 상태: 설계 승인됨. 구현은 별도 세션에서 진행 (이 문서만 보고 구현 가능하도록 작성).

## 1. 목표와 범위

**통합 대상 (6개)**: Analytics, ChannelAdapter, Membership, Notification, Search, UgcService

**제외**: Core / Medusa / Wallet / FileService (트래픽·중요도), Observability(Alloy, 인프라성 사이드카)

**기대 효과** (2026-07-03 비용 리포트 `docs/aws-cost-report-2026-07-03.md` 기준):

- 현재: 6개 태스크 × 0.25 vCPU / 0.5 GB arm64 = 월 $49.74
- 통합 후: 1개 태스크 0.5 vCPU / 2 GB arm64 ≈ 월 $19.6 → **월 ~$30 절감**
- 부수 효과: ECR 이미지 수 감소(공유 `node_modules`로 총 용량도 감소), 배포 시간 단축, Express 앱들의 ALB keep-alive 502 리스크 해소

**불변 조건 (클라이언트 무변경)**:

- 외부 URL 유지: `analytics.…`, `channel-adapter.…`, `membership.…`, `notification.…`, `search.…`, `ugc.…` — storefront/admin-web은 `BACKEND_DOMAIN` + slug 규칙으로 URL을 조립하므로 반드시 유지.
- Kafka consumer group ID 전부 유지 (오프셋 이주 없음).
- 각 앱의 `OTEL_SERVICE_NAME` 유지 (Grafana 대시보드/로그 라벨 연속성).

## 2. 현재 상태 (2026-07-04 확인)

| 앱 | 어댑터 | 포트 | 비고 |
|---|---|---|---|
| Analytics | Fastify ✅ | 3040 | `@fastify/cookie` 사용 |
| Membership | Fastify ✅ | 3000 | Passport 호환 `onRequest` 훅 있음 |
| UgcService | Fastify ✅ | 3030 | |
| ChannelAdapter | Express ❌ | 3000 | main.ts에 FastifyAdapter가 주석 처리된 채 잔존 |
| Notification | Express ❌ | 3000 | `body-parser` verify 핵으로 `req.rawBody` 저장 (웹훅 HMAC 서명 검증용), `applyAlbKeepAlive` 사용 |
| Search | Express ❌ | 3000 | `applyAlbKeepAlive` 사용 |

- SST 인프라: `deployments/lcnine/services/infra/services.ts` (서비스 정의) + `shared.ts` (`createService()` 헬퍼).
- `createService()`는 wildcard ALB(SharedAlb) 한 대에 `transform.listenerRule`로 hostHeader 조건을 덮어써 host 기반 멀티플렉싱.
- SST `Service`의 `loadBalancer.rules`는 룰 여러 개 + 룰별로 다른 `forward` 포트를 지원 (포트별 target group 생성). 헬스체크도 `health: { '<port>/http': {...} }`로 포트별 지정 가능. `.sst/platform/src/components/aws/service.ts`의 `ServiceRules` 인터페이스로 확인함.
- Notification 웹훅 서명 검증 위치: `apps/notification/src/shared/decorators/webhook-signature.decorator.ts`, `apps/notification/src/shared/controllers/webhook.controller.ts` — 둘 다 `request.rawBody`를 읽음 (Resend svix, Kakao/Toast HMAC).
- dev 스테이지는 제거된 상태 — live만 배포 중.

## 3. 아키텍처: 단일 컨테이너 · 다중 프로세스

검토한 대안 중 **단일 컨테이너에 6개 Node 프로세스**를 택했다. 단일 Nest 프로세스로 모듈 병합하는 안은 메모리 절감이 더 크지만, 앱마다 다른 글로벌 파이프/필터/CORS/웹훅 파서 설정의 충돌 조정과 DI 토큰 충돌 리스크가 커서 기각.

```
┌─ Fargate Task (0.5 vCPU / 2GB, arm64, min1/max1) ─┐
│  Container: services-bundle image                  │
│   supervisor.mjs                                   │
│    ├─ analytics        :3040                       │
│    ├─ channel-adapter  :3001                       │
│    ├─ membership       :3002                       │
│    ├─ notification     :3003                       │
│    ├─ search           :3004                       │
│    └─ ugc-service      :3030                       │
└────────────────────────────────────────────────────┘
          ▲ SharedAlb host 기반 라우팅 (룰 6개)
  analytics.… → :3040, membership.… → :3002, …
```

**포트 배치**: analytics 3040 / ugc 3030 은 기존 유지, 나머지는 3001~3004 로 재배치. 모든 앱이 `PORT` env를 읽으므로 앱 코드 변경 없음.

## 4. 1단계 — Fastify 전환 (PR 3개, 개별 배포로 검증)

번들 통합 전에 어댑터 전환을 기존 개별 태스크 상태에서 배포·검증한다. 문제 발생 시 원인이 어댑터인지 통합인지 분리하기 위함.

| PR | 앱 | 작업 |
|---|---|---|
| #1 | channel-adapter | 주석 처리된 `FastifyAdapter` 활성화 (`NestFactory.create<NestFastifyApplication>(AdapterModule, new FastifyAdapter(), …)`), main.ts의 죽은 주석 정리 |
| #2 | search | `FastifyAdapter` 적용. `applyAlbKeepAlive` 제거 — Fastify 기본 keepAliveTimeout 72s > ALB idle 60s 라 패치 불필요 |
| #3 | notification | `FastifyAdapter` + `NestFactory.create(..., { rawBody: true })`로 body-parser verify 핵 전체 대체. `applyAlbKeepAlive` 제거 |

각 PR: 머지 → live 배포 → 스모크 테스트 통과 후 다음 PR 진행.

**전환 시 주의사항**:

- **Notification rawBody**: NestJS 내장 `rawBody: true`는 Express/Fastify 모두 지원하며 `req.rawBody`에 `Buffer`를 넣는다. 기존 body-parser 핵은 **string**을 넣었으므로, 서명 검증 코드(`webhook-signature.decorator.ts`, `webhook.controller.ts`)에서 `request.rawBody` 사용부를 Buffer/string 양쪽 호환으로 확인·수정할 것. svix 라이브러리는 Buffer 허용, `crypto.createHmac().update()`도 Buffer 허용이지만 `JSON.stringify(request.body)` fallback 경로와의 비교 로직을 실제로 확인해야 함.
- **Notification 전용 필터**: `AllExceptionsFilter`는 notification 자체 필터 — Fastify 응답 API(`reply.status().send()` vs `res.status().json()`) 의존 여부 확인.
- **Express 미들웨어 사용처 전수 조사**: `app.use(...)` 호출, `@Res()`/`@Req()`에 Express 타입 주입하는 컨트롤러, interceptor에서 `res.setHeader` 등 raw response 접근하는 코드를 앱별로 grep 후 Fastify 호환으로 수정.
- **Swagger**: `@nestjs/swagger`는 Fastify 지원. analytics/ugc처럼 `onSend` 훅으로 charset 처리하는 기존 Fastify 앱 패턴 참고.

**스모크 테스트 (앱별)**:

- channel-adapter: `/health`, admin-web 채널 동기화 화면, InboxWorker 로그 정상 (Grafana Loki: `service_name="channel-adapter"`)
- search: `/health`, storefront 상품 검색, Kafka 인덱싱 로그
- notification: `/health`, **Resend 웹훅 (svix 서명)**, **Kakao/Toast 웹훅 (HMAC)** — 서명 검증 실패가 이 전환의 최대 리스크 지점

## 5. 2단계 — 번들 통합 (PR 1개)

### 5.1 번들 이미지

`deployments/lcnine/services/bundle/Dockerfile` (context = 모노레포 루트, 기존 앱 Dockerfile들과 동일한 멀티스테이지 패턴):

- deps / deps-prod 스테이지: 기존과 동일 (`npm ci`, `npm ci --omit=dev`)
- builder: 6개 앱 소스 복사 후 `nest build` × 6 (`npm run build:analytics` 등 기존 빌드 스크립트 활용, 없는 앱은 package.json에 추가)
- runner: `dist/apps/<app>/` 6개 + 공유 `node_modules` + `supervisor.mjs`. non-root user, `CMD ["node", "supervisor.mjs"]`
- arm64 (기존 서비스들과 동일)

### 5.2 supervisor.mjs

외부 의존성 없는 단일 파일 Node 스크립트 (pm2 등 추가 금지). 책임:

1. **spawn**: 앱 6개를 `node dist/apps/<app>/main.js`로 기동. 각 자식의 env는 아래 규칙으로 조립:
   - 공유 env (프리픽스 없음): `NODE_ENV`, `OTEL_EXPORTER_OTLP_ENDPOINT` 등 전 앱 공통 값
   - 앱별 env: 태스크 env의 `<APP_PREFIX>__KEY` (예: `ANALYTICS__DATABASE_URL`)를 프리픽스 제거 후 주입. 프리픽스: `ANALYTICS__`, `CHANNEL_ADAPTER__`, `MEMBERSHIP__`, `NOTIFICATION__`, `SEARCH__`, `UGC__`
   - `PORT`, `OTEL_SERVICE_NAME`은 supervisor가 앱별 상수로 직접 지정
2. **재시작**: 자식 종료 시 지수 백오프(예: 1s → 2s → … 최대 30s)로 재시작. 무한 재시작 허용 (태스크 전체를 죽이지 않음 — 태스크 교체는 ALB 헬스체크가 최후 수단으로 담당).
3. **graceful shutdown**: SIGTERM 수신 시 전 자식에 SIGTERM 전파 → 모두 종료 대기(최대 55s) → exit 0. 자식 stdout/stderr는 그대로 상속(pino JSON 로그가 CloudWatch로 직행, 각 로그에 `service_name`이 이미 박혀 있어 구분됨).

### 5.3 services.ts / shared.ts 변경

- 기존 6개 `createService()` 호출 삭제.
- `createService('ServicesBundle', …)` 1개 추가:
  - `loadBalancer.rules`: 6개 룰, 각각 `listen: '443/https'`, `forward: '<port>/http'`, priority는 기존 값 재사용 (110/120/130/140/160/200)
  - `transform.listenerRule`: 룰이 6개가 되므로 현재의 "전체 룰에 같은 hostHeader" 방식은 못 씀. **priority → hostname 매핑 테이블**로 룰별 hostHeader를 덮어쓴다 (listenerRule transform의 args에서 priority 식별 가능). `createService` 헬퍼 시그니처를 다중 룰 지원으로 확장하거나 번들 전용 헬퍼를 추가 — 구현 시 기존 단일 룰 서비스(Core/Wallet 등)가 깨지지 않게 하위호환 유지.
  - `loadBalancerHealth`: 6개 포트 각각 `/health` (기존 앱별 path/threshold 그대로. **wallet처럼 prefix가 다른 앱은 없는지 재확인** — 6개 모두 `/health`인지 컨트롤러 확인 후 확정)
  - `environment`: 기존 6개 서비스의 env를 앱 프리픽스 붙여 병합. `kafkaEnv()`/`dbUrl()` 등 기존 헬퍼 결과에 프리픽스를 씌우는 유틸 추가
  - 스펙: `cpu: '0.5 vCPU'`, `memory: '2 GB'`, `architecture: 'arm64'`, `scaling: { min: 1, max: 1 }`
  - `transform.taskDefinition` 또는 container 옵션으로 `stopTimeout: 60` (channel-adapter `INBOX_SHUTDOWN_DRAIN_MS=25000` + 나머지 drain 여유)
- **UgcService 주의**: 현재 `loadBalancerHealth` 미지정 (기본 헬스체크) — 번들에서는 명시적으로 `/health` 지정.
- 삭제되는 SST Service 6개는 `sst deploy` 시 자동 제거됨 (live는 `protect: true`지만 Service 리소스는 replace가 아닌 delete라 확인 필요 — deploy 전 `sst diff`로 삭제 목록 검토).

### 5.4 메모리 산정 근거

Nest+Fastify 프로세스 실측 RSS는 대략 150~250MB. 6개 × 250MB = 1.5GB + 여유 0.5GB → 2GB. 배포 후 CloudWatch `MemoryUtilization`으로 확인, 80% 초과 상시면 3GB로 상향 (+$3/월). OOM 시 supervisor가 아니라 컨테이너 전체가 죽으므로 여유를 아끼지 말 것.

## 6. 트레이드오프 (승인된 감수 사항)

- **배포 단위 결합**: 6개 중 하나만 수정해도 태스크 전체 롤링 재배포. ECS 롤링(신규 기동 → 구 태스크 drain)이라 다운타임은 없음.
- **헬스체크 연쇄**: 한 앱의 target group unhealthy → ECS가 태스크 전체 교체. supervisor 개별 재시작이 1차 방어, 태스크 교체는 최후 수단.
- **noisy neighbor**: 한 앱의 CPU 폭주(예: search 재색인)가 나머지에 영향. 완화책: 문제 앱만 `services.ts`에서 개별 `createService()`로 도로 분리 — **부분 분리/전체 롤백이 인프라 코드 revert만으로 가능**한 것이 이 구조의 핵심 안전장치.

## 7. 검증 전략

dev 스테이지가 없으므로:

1. **로컬 docker 검증** (live 배포 전 필수): 번들 이미지 빌드 → 로컬 env로 6개 프로세스 기동 → `/health` 6종 응답 + SIGTERM graceful shutdown 확인. DB/Kafka 미연결 상태에서도 HTTP 부팅은 확인 가능해야 함 (Kafka는 `KAFKA_BROKERS` 미설정 시 consumer 비활성 fallback 있음).
2. **live 배포 직후 체크리스트**:
   - 6개 hostname HTTPS 응답 (`curl https://<slug>.almondyoung-next.com/health`)
   - Kafka consumer 6개 그룹 재접속 (Grafana Loki: 각 `service_name` 부팅 로그)
   - Resend/Kakao 웹훅 실동작 (notification)
   - storefront 검색, admin-web 멤버십/알림/채널 화면
   - CloudWatch Memory/CPU Utilization 24h 관찰
3. **롤백**: `services.ts` revert → `sst deploy`. 데이터/스키마 변경이 전혀 없는 순수 인프라 변경이라 롤백 안전.

## 8. 비용 요약

| 항목 | 현재 | 통합 후 |
|---|---:|---:|
| 경량 서비스 6 태스크 | $49.74/월 | — |
| ServicesBundle 1 태스크 (0.5 vCPU/2GB arm64) | — | ~$19.6/월 |
| **절감** | | **~$30/월 (연 ~$360)** |

ALB는 SharedAlb를 그대로 쓰므로 ALB 비용 변화 없음. 퍼블릭 IP도 변화 없음 (태스크는 프라이빗 서브넷).

## 9. PR 분할 요약

1. PR#1 channel-adapter Fastify 전환 → 배포·검증
2. PR#2 search Fastify 전환 → 배포·검증
3. PR#3 notification Fastify 전환 (rawBody) → 배포·검증 (웹훅 중점)
4. PR#4 번들 Dockerfile + supervisor.mjs + services.ts/shared.ts 통합 → 로컬 docker 검증 → live 배포 → 구 서비스 6개 제거 확인
