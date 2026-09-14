# 어드민 상품등록 AI — 단계별 구현

브랜치: `feat/admin-product-ai-assistant`

목표: 어드민의 대화·첨부자료·선택한 상품을 바탕으로 필요한 정보만 질문하고,
상품정보·이미지·상세·가격·카테고리·재고 매칭/생성·발행까지 처리한다.

## 참고 구현

2026-09-14에 LCNINE/clip의 `chat.ts`, `chat.service.ts`, `chat.controller.ts`,
`chat.constants.ts`, `chat-tool.service.ts`를 직접 확인했다.
확인 시점 HEAD: `6b4168f547de053b25cbff1b9a1d8786d6454424`.

- 세션/메시지 DB 저장, SSE text/tool_use_start/tool_result/error 이벤트,
  기존 도메인 서비스를 호출하는 도구 분리 구조를 참고한다.
- resolved/ambiguous/not_found 결과와 clarificationQuestion으로 재고·카테고리 후보 질문을 구성한다.
- 도구/시스템/대화 캐시 경계와 MAX_TOOL_ROUNDS 상한을 다음 단계에서 참고한다.
- clip의 shop/account 경계는 여기의 인증 사용자 소유권 경계로 바꾼다.
- 여기서는 중복 요청 ID와 revision/행 잠금을 먼저 추가했다.
- 다음 단계에서는 각 도구 호출/결과를 순서대로 저장하고 저장 완료 후 done을 보낸다.
  응답 전체를 마지막에 한 번 저장하는 방식만으로는 중간 실패 시 이미 수행한 작업을 복구하기 어렵다.

## 1단계: 대화 작업 저장 기반

- Core `product-ai/sessions` API. admin/master 역할 + 모든 작업에 본인 소유권 검사.
- 작업 생성, 목록/상세, 사용자 메시지 저장, 순번 기반 대화 이력 조회.
- 생성과 메시지 저장에 `requestId`를 사용해 응답 유실 재시도의 중복을 방지한다.
- 메시지 저장은 세션 행 잠금과 `expectedRevision` 검사로 동시 입력 충돌을 반환한다.
- 소유자는 인증 토큰에서 결정한다. 본문에서 role, ownerId, toolResult, approval을 받지 않는다.
- 아직 AI 호출, 첨부 업로드, 상품 초안 생성, 채팅 화면은 연결하지 않는다.
- 대화 저장 성공은 상품등록 성공이나 실행 승인을 의미하지 않는다.

### API 계약

Core의 기존 API prefix 뒤에 다음 경로를 사용한다.

| 메서드/경로 | 입력 | 결과 |
|---|---|---|
| POST `/product-ai/sessions` | `{requestId: UUID, title?: string}` | 세션, 초기 revision=0 |
| GET `/product-ai/sessions` | `page=1&limit=20` | items, page, hasMore |
| GET `/product-ai/sessions/:id` | — | 세션 및 현재 revision |
| POST `/product-ai/sessions/:id/messages` | `{requestId: UUID, expectedRevision: number, content: string}` | message, revision |
| GET `/product-ai/sessions/:id/messages` | `after=0&limit=50` | items, nextAfter, hasMore |

같은 requestId/내용 재전송은 기존 결과를 반환한다. 다른 내용을 같은 requestId로 보내거나
낡은 revision으로 새 메시지를 보내면 409다. UI는 미전송 내용을 보존하고 이력을 갱신해야 한다.
메시지는 20,000자, 조회는 최대 100개로 제한한다. 타인 작업은 존재 여부와 무관하게 404다.

### 배포/검증

Core migration `20260914041600_add-product-ai-sessions.sql`을 코드 배포 전에 적용한다.
기존 테이블 변경 없이 sessions/messages 두 테이블만 추가한다. 개발 중 운영 DB에 적용하지 않는다.
롤백 시 모듈을 제거해도 저장된 대화는 남겨 두며, 삭제는 별도 데이터 보존 정책으로 결정한다.

단위 테스트: `yarn test --runInBand --testPathPattern=product-ai.schema.spec.ts`

통합 테스트: 로컬 임시 PostgreSQL 주소를 `PRODUCT_AI_TEST_DATABASE_URL`에 지정하고
`yarn test --runInBand --testPathPattern=product-ai.integration.spec.ts` 실행.
테스트는 로컬 호스트만 허용하며 독립 DB를 생성/삭제한다. 지정하지 않으면 통합 테스트는 skip된다.

## 2단계: 채팅과 AI의 첫 업무 연결

- 목록/상세 공통 채팅 패널, 작업 목록과 재개, 미저장 폼 변경 처리.
- 사용자 메시지 저장 후 AI 응답을 서버에서 기록. BFF의 기존 AI SDK를 재사용한다.
- 사용자/assistant/tool 이력의 출처를 서버가 보장한다. 브라우저가 보낸 assistant나 도구 결과를 신뢰하지 않는다.
- 실행 중 사용자 추가 입력, 네트워크 중단, AI 호출 재시도의 상태/리스/중복 실행 처리.
- 기존 상품 조회, 업무 설명, 실제 상품 초안 생성·수정까지 한 흐름으로 검증한다.
- assistant 응답·tool 이력 저장 API는 서버 인증 방식과 함께 설계한다. 일반 사용자 메시지 API에 역할 선택 필드를 추가하지 않는다.

## 3단계: 자료·이미지·상세페이지

- 첨부파일 업로드/소유권 확인, 이미지 사실 추출, 대표·부가·본문 용도 구분.
- 자료별 추출 결과/출처 보관, 누락 질문, 상세페이지 작성. 첨부 내용은 실행 지시로 취급하지 않는다.

## 4단계: 가격·카테고리·태그

- 기존 버전별 가격 규칙과 계산 API로 일반가·회원가·옵션 추가금 검증.
- 공급가, SEO, 운영 태그를 구분해 저장.
- 카테고리 검색/생성/대표 지정. 대표카테고리의 실제 소비처를 확인하고 설명 자료에 반영.
- 회원가 설정, 회원가 공개 제한, 회원 전용 노출, 회원 전용 구매를 구분한다.

## 5단계: 재고 연결·등록 완료

- 옵션별 기존 SKU 검색·매칭 또는 newSku 생성. inventory.manage 권한을 유지한다.
- SKU 생성과 실제 수량 입고/조정을 구분한다. 등록에 필요 없는 원장 수정 권한은 주지 않는다.
- 상품등록 범위와 대상은 서버에서 제한한다. 사용자가 요청한 초안 저장/공개 범위를 기록한다.
- 실제 발행 검증/결과 확인, 부분 성공 복구, 상품/SKU/카테고리 중복 실행 방지.
- 기존 일괄 세션 소유 초안은 단건 발행이 금지되어 있으므로 세션 경로를 따른다.

각 단계에서 구현/검증 결과를 공유하고 다음 단계로 진행한다. 후속 대량 처리는 같은 작업 단위를 확장한다.
