# Wallet 앱 구조/모듈/파일 역할 정리

## 1. 문서 범위
- 기준 경로: `apps/wallet`
- 기준 시점: 현재 워크스페이스 코드 상태
- 포함 대상:
`src/` 소스 코드, 테스트 파일(`*.spec.ts`, `*.integration.spec.ts`), Drizzle 마이그레이션/메타 파일, 앱 루트 설정 파일, 환경 파일

## 2. 상위 구조
- `apps/wallet/`
결제/정산 도메인 앱 루트
- `apps/wallet/src/`
실행 코드 + 단위/통합 테스트
- `apps/wallet/drizzle/`
DB 마이그레이션 SQL + Drizzle 메타데이터

## 3. 폴더/모듈 역할
- `src/auth`
Wallet 서비스에서 등록/사용할 권한 스코프 정의
- `src/config`
환경 변수 스키마 검증
- `src/database`
DB 트랜잭션 유틸 및 DB 제약 통합 테스트
- `src/domain/hmac`
결제 스냅샷 무결성(HMAC) 검증 로직
- `src/domain/idempotency`
HTTP/Command 멱등성 레코드 저장소, 서비스, 인터셉터
- `src/domain/state-transition`
상태 전이 허용 규칙과 전이 실행 서비스
- `src/intents`
결제 인텐트 생성/다리(leg) 실행/종료/환불 오케스트레이션
- `src/intents/application`
유스케이스별 애플리케이션 서비스 구현
- `src/intents/dto`
API 요청 DTO 정의
- `src/intents/support`
attempt/manual queue 공통 보조 서비스
- `src/intents/test-helpers`
통합 테스트 앱 부트스트랩/공용 유틸(현재 로컬 ignored 상태)
- `src/jobs`
스케줄 기반 만료/정합성 배치 잡
- `src/messaging`
Outbox 발행, 이벤트 빌더, 커맨드 컨슈머
- `src/providers`
결제 Provider 추상화/레지스트리/구현체
- `src/reconcile`
정합성 재처리 API + 서비스

## 4. 파일별 역할

### 4.1 앱 루트 파일
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/.env` | Wallet 로컬 실행용 환경 변수 파일 |
| `apps/wallet/.env.test` | Wallet 테스트 실행용 환경 변수 파일 |
| `apps/wallet/tsconfig.app.json` | Wallet 앱 TypeScript 빌드 설정 |
| `apps/wallet/drizzle.config.ts` | 운영/개발 DB 스키마 기준 Drizzle 설정 (`src/schema.ts`) |
| `apps/wallet/drizzle.test.config.ts` | 테스트 DB 스키마 기준 Drizzle 설정 (`src/schema.test.ts`) |

### 4.2 Drizzle 마이그레이션/메타
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/drizzle/0000_famous_dragon_lord.sql` | Wallet 초기 결제 도메인 테이블/enum/index 생성 |
| `apps/wallet/drizzle/0001_phase5a_payment_safety_schema.sql` | Phase5A 안전성 리팩토링 스키마 변경(시도 operation/idempotency key, outbox dead-letter, idempotency updatedAt 등) |
| `apps/wallet/drizzle/meta/_journal.json` | Drizzle 마이그레이션 적용 이력 인덱스 |
| `apps/wallet/drizzle/meta/0000_snapshot.json` | `0000` 시점 스키마 스냅샷 |
| `apps/wallet/drizzle/meta/0001_snapshot.json` | `0001` 시점 스키마 스냅샷 |

### 4.3 src 최상위
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/main.ts` | Nest 앱 부트스트랩, 글로벌 파이프/필터, Swagger, 커맨드 스트림 컨슈머 연결 |
| `apps/wallet/src/wallet.module.ts` | Wallet DI 조립 루트 모듈(controllers/providers/guard/interceptor/job 등록) |
| `apps/wallet/src/schema.ts` | Wallet 핵심 DB 스키마(enum, table, index, 타입 export) |
| `apps/wallet/src/schema.test.ts` | 테스트용 스키마 export 허브 (`walletTestSchema`) |
| `apps/wallet/src/types.ts` | Drizzle 추론 타입 및 DB 트랜잭션 타입 별칭 |
| `apps/wallet/src/health.controller.ts` | `/v1/health`, `/v1/ready` 공개 헬스체크 API |

### 4.4 auth
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/auth/wallet.scopes.ts` | Wallet 서비스 권한 스코프 정의 목록 |

### 4.5 config
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/config/env.validation.ts` | zod 기반 환경 변수 유효성 검증 |

### 4.6 database
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/database/tx.util.ts` | 외부 tx 주입 여부에 따라 in-tx 실행을 통일하는 유틸 |
| `apps/wallet/src/database/schema.constraints.integration.spec.ts` | DB 제약(부분 unique/index/not-null/webhook receipt unique) 통합 검증 |

### 4.7 domain/hmac
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/domain/hmac/hmac-integrity.ts` | 스냅샷 canonicalization + HMAC 서명 검증 + timestamp/skew/ttl 검증 |
| `apps/wallet/src/domain/hmac/hmac-integrity.spec.ts` | HMAC 무결성 로직 단위 테스트 |

### 4.8 domain/idempotency
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/domain/idempotency/idempotency.schema.ts` | `idempotency_keys` 테이블 스키마 및 레코드 타입 |
| `apps/wallet/src/domain/idempotency/idempotency.repository.ts` | 멱등 레코드 저장소 인터페이스/Drizzle 구현(락 조회, 조건부 업데이트) |
| `apps/wallet/src/domain/idempotency/idempotency.service.ts` | HTTP/Command 공통 멱등 begin/complete 오케스트레이션 |
| `apps/wallet/src/domain/idempotency/http-idempotency.interceptor.ts` | 쓰기 HTTP API에 멱등 처리 적용하는 Nest 인터셉터 |
| `apps/wallet/src/domain/idempotency/idempotency.service.spec.ts` | 멱등 서비스 단위 테스트 |
| `apps/wallet/src/domain/idempotency/http-idempotency.interceptor.spec.ts` | 멱등 인터셉터 단위 테스트 |

### 4.9 domain/state-transition
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/domain/state-transition/state-transition.rules.ts` | 엔티티별 상태 전이 허용 규칙 정의 |
| `apps/wallet/src/domain/state-transition/state-transition.service.ts` | 상태 전이 실행 + 전이 이력 저장 + outbox append |
| `apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts` | 상태 전이 규칙 테스트 |
| `apps/wallet/src/domain/state-transition/state-transition.service.spec.ts` | 상태 전이 서비스 테스트(예: optimistic lock conflict) |

### 4.10 intents 실행 계층
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/intents/intents.controller.ts` | 인텐트/레그/취소/대체/환불요청 HTTP 엔드포인트 |
| `apps/wallet/src/intents/refund-requests.controller.ts` | 환불요청 조회 HTTP 엔드포인트 |
| `apps/wallet/src/intents/intents.service.ts` | Facade 서비스(세부 application 서비스로 위임) |
| `apps/wallet/src/intents/application/intents.service.types.ts` | intents application 공용 결과 타입 정의 |
| `apps/wallet/src/intents/application/intent-creation.service.ts` | 인텐트 생성/조회/레그 구성 처리 |
| `apps/wallet/src/intents/application/leg-execution.service.ts` | authorize/capture 실행 및 attempt/intent/leg 상태 반영 |
| `apps/wallet/src/intents/application/intent-termination.service.ts` | cancel/supersede/expire + 보상(compensation) 오케스트레이션 |
| `apps/wallet/src/intents/application/refund-orchestration.service.ts` | 환불요청 생성/배분 검증/환불 실행/실패시 manual queue 처리 |
| `apps/wallet/src/intents/support/attempt.service.ts` | attempt 생성, provider 결과/실패 영속화 공통 로직 |
| `apps/wallet/src/intents/support/manual-action-queue.service.ts` | 수동 조치 큐 upsert/중복 방지/갱신 로직 |
| `apps/wallet/src/intents/dto/create-intent.dto.ts` | 인텐트 생성 요청 DTO |
| `apps/wallet/src/intents/dto/configure-legs.dto.ts` | 결제 레그 구성 요청 DTO |
| `apps/wallet/src/intents/dto/create-refund-request.dto.ts` | 환불요청 생성 DTO |
| `apps/wallet/src/intents/test-helpers/wallet-test-app.ts` | 통합 테스트용 Nest 앱/DB 컨텍스트/요청 헬퍼/데이터 정리 유틸 (현재 git ignored 로컬 파일) |

### 4.11 intents 테스트 파일
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/intents/intents.service.spec.ts` | `IntentsService` 핵심 시나리오 단위 테스트 |
| `apps/wallet/src/intents/intents.phase2.core.integration.spec.ts` | Phase2 핵심 플로우 통합 테스트(인텐트 생성/조회/HMAC/zero-amount) |
| `apps/wallet/src/intents/intents.phase2.idempotency.integration.spec.ts` | Phase2 HTTP 멱등성 통합 테스트 |
| `apps/wallet/src/intents/intents.phase2.legs.integration.spec.ts` | Phase2 레그 authorize/capture 및 capability/action 상태 통합 테스트 |
| `apps/wallet/src/intents/intents.phase2.supersede.integration.spec.ts` | Phase2 concurrent reference-blocking + supersede 경로 통합 테스트 |
| `apps/wallet/src/intents/intents.phase3.compensation.integration.spec.ts` | Phase3 보상 순서/실패시 queue+event 처리 통합 테스트 |
| `apps/wallet/src/intents/intents.phase3.expiration.integration.spec.ts` | Phase3 만료 + 보상 + reconcile-required 경로 통합 테스트 |
| `apps/wallet/src/intents/intents.phase3.refunds.integration.spec.ts` | Phase3 환불요청/배분/실패 처리 통합 테스트 |
| `apps/wallet/src/intents/intents.hmac.integration.spec.ts` | HMAC 검증 실패시 DB 접근 차단 통합 테스트 |
| `apps/wallet/src/intents/intents.http-idempotency.integration.spec.ts` | HTTP 인터셉터 기반 멱등 재생/충돌/진행중 처리 통합 테스트 |

### 4.12 jobs
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/jobs/expiration.job.ts` | 만료 배치 스케줄 실행(주기적으로 `expireDueIntents`) |
| `apps/wallet/src/jobs/reconcile.job.ts` | reconcile 배치 스케줄 실행 |

### 4.13 messaging
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/messaging/payments-event.builder.ts` | 결제/환불 이벤트 payload 빌더 및 검증 |
| `apps/wallet/src/messaging/payments-event.builder.spec.ts` | 이벤트 payload 빌더 테스트 |
| `apps/wallet/src/messaging/outbox-event.util.ts` | outbox insert 값 생성 유틸(메시지 ID/기본값 포함) |
| `apps/wallet/src/messaging/outbox-event.util.spec.ts` | outbox util 테스트 |
| `apps/wallet/src/messaging/outbox-dispatcher.service.ts` | outbox 배치 획득/발행/백오프/DEAD_LETTER/재큐 처리 |
| `apps/wallet/src/messaging/outbox-dispatcher.service.spec.ts` | outbox dispatcher 단위 테스트 |
| `apps/wallet/src/messaging/outbox-dispatcher.integration.spec.ts` | outbox 파티션 순서/HOL 해소 통합 테스트 |
| `apps/wallet/src/messaging/payments-command.consumer.ts` | payments commands 이벤트 컨슈머 + command idempotency 처리 |
| `apps/wallet/src/messaging/payments-command.consumer.spec.ts` | command consumer 단위 테스트 |

### 4.14 providers
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/providers/payment-provider.types.ts` | Provider 추상 인터페이스/요청/응답/Capability 타입 정의 |
| `apps/wallet/src/providers/provider.errors.ts` | Provider 관련 표준 예외 헬퍼 |
| `apps/wallet/src/providers/provider.registry.ts` | Provider 등록/조회/Capability 검증 레지스트리 |
| `apps/wallet/src/providers/points.provider.ts` | POINTS provider 구현(기본 authorize/capture/cancel/refund/poll) |
| `apps/wallet/src/providers/points.provider.spec.ts` | POINTS provider 단위 테스트 |

### 4.15 reconcile
| 파일 | 역할 |
| --- | --- |
| `apps/wallet/src/reconcile/reconcile.service.ts` | pollable attempt/leg/intent 정합성 배치 및 수동 재처리 로직 |
| `apps/wallet/src/reconcile/reconcile.controller.ts` | 관리자 reconcile retry API |
| `apps/wallet/src/reconcile/dto/retry-reconcile.dto.ts` | reconcile retry 요청 DTO |
| `apps/wallet/src/reconcile/reconcile.service.integration.spec.ts` | reconcile 서비스 통합 테스트 |

## 5. 모듈 관계 요약
- 진입점:
HTTP는 `intents.controller.ts`, `refund-requests.controller.ts`, `reconcile.controller.ts`, 메시징은 `payments-command.consumer.ts`
- 핵심 오케스트레이션:
`intents.service.ts`가 생성/실행/종료/환불 서비스로 위임
- 상태 일관성 축:
`state-transition.service.ts` + `payment_state_transitions` + `attempt.service.ts`
- 비동기 전달 축:
`outbox_event.util.ts` + `outbox-dispatcher.service.ts` + 이벤트 빌더
- 안전성 축:
`hmac-integrity.ts`, `idempotency.service.ts`, `reconcile.service.ts`
