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

### 요청 검증/Swagger 구성

Core의 `createGlobalValidationPipe()`가 DTO 종류를 구분한다. `createZodDto(schema)`로 만든
클래스는 Zod로, 기존 class-validator DTO는 기존 ValidationPipe 설정으로 검증한다.
두 파이프를 연달아 실행하지 않으므로 Zod DTO의 필드가 whitelist에 의해 지워지지 않는다.

상품 AI의 `dto/product-ai.dto.ts`가 스키마를 DTO 클래스로 연결한다.
컨트롤러에서는 `@Query() query: ListProductAiMessagesQueryDto`, `@Body() body: ...Dto`,
`@Param() params: ProductAiSessionParamsDto`만 선언한다. 런타임에 클래스가 필요하므로
컨트롤러의 DTO import는 `import type`으로 바꾸지 않는다.

Swagger 문서는 DTO 스키마에서 생성하고 main.ts에서 `cleanupOpenApiDoc`으로 정리한다.
상품 AI 쿼리에 별도 `@ApiQuery`를 중복 작성하지 않는다. 기존 클래스 DTO의 문서화 방식은 유지한다.

### 배포/검증

Core migration `20260914041600_add-product-ai-sessions.sql`을 코드 배포 전에 적용한다.
기존 테이블 변경 없이 sessions/messages 두 테이블만 추가한다. 개발 중 운영 DB에 적용하지 않는다.
롤백 시 모듈을 제거해도 저장된 대화는 남겨 두며, 삭제는 별도 데이터 보존 정책으로 결정한다.

단위 테스트: `yarn test --runInBand --testPathPattern=product-ai.schema.spec.ts`

통합 테스트: 로컬 임시 PostgreSQL 주소를 `PRODUCT_AI_TEST_DATABASE_URL`에 지정하고
`yarn test --runInBand --testPathPattern=product-ai.integration.spec.ts` 실행.
테스트는 로컬 호스트만 허용하며 독립 DB를 생성/삭제한다. 지정하지 않으면 통합 테스트는 skip된다.

## 2단계 A: 채팅과 AI 응답 연결 (구현)

- `/mall/product-ai`에서 새 대화, 내 대화 목록, 이력 재개, 메시지 전송, AI 답변 재시도를 제공한다.
- 어드민 우측 상단 `아몬드영 AI` 버튼에서 공통 패널을 연다. 상품관리 드롭다운의 별도 AI 항목은 제거했다.
- 패널은 자체 세션 선택 상태를 사용해 현재 URL/작성 중인 상품 폼을 변경하지 않는다.
  닫아도 채팅 컴포넌트 상태는 유지하고 숨겨진 패널의 목록 조회/폴링은 중지한다.
- 패널의 `전체보기`는 선택한 sessionId로 기존 `/mall/product-ai` 페이지를 연다.
- 미지원 작업은 직접 실행할 수 없음을 설명하고 가능한 안내를 제공하도록 시스템 지침에 명시한다.
  이 지침 자체를 권한 경계로 사용하지 않는다. 현재 provider는 tools를 전달하지 않고 고정 모델 URL만 호출한다.
  기존 admin/master 검사와 본인 대화 소유권 검사를 유지하며, 답변은 HTML이 아닌 일반 텍스트로 표시한다.
- 상품 목록/상세의 `상품등록 AI` 링크로 진입한다. 현재 화면의 미저장 폼이나 상품은 자동 전송하지 않는다.
- `POST /product-ai/sessions/:id/respond {messageId}`가 서버에 저장된 사용자 메시지에 답변한다.
- 생성 주체를 신뢰할 수 있도록 모델 호출과 assistant 저장을 Core에서 함께 처리한다.
  BFF에는 모델 답변을 입력받아 저장하는 공개 API를 만들지 않는다.
- 메시지 저장 후 상태는 pending → running → idle 또는 failed다. 실패 시 사용자 메시지는 유지된다.
- 같은 답변의 중복 요청은 진행 상태/완료 상태만 돌려준다. 응답 생성 리스는 60초이며,
  서버 중단 후 만료되면 사용자가 재시도할 수 있다. 이전 실행의 늦은 답변은 리스 ID로 차단한다.
- `respond-stream`은 실제 모델 text_delta를 SSE로 전달한다. 프록시는 SSE를 버퍼링하지 않는다.
  `done`은 assistant 저장 트랜잭션 이후에만 보낸다. 기존 `respond`도 호환용으로 유지한다.
- 실제 상품 저장·파일 첨부·현재 상품 자동 참조는 아직 제공하지 않으며 화면과 시스템 지침에 명시한다.

### 실행 설정과 확인 범위

- Core에 `ANTHROPIC_API_KEY` 설정이 필요하다. 기존 admin-web 환경변수만으로 Core에 전달되지 않는다.
- 선택 설정 `PRODUCT_AI_MODEL`; 기본값은 기존 코드와 같은 `claude-sonnet-5`다.
- HTTP Messages API를 사용하므로 Core에 SDK 의존성은 추가하지 않는다.
- 모델 요청 제한 20초, 출력 1,500토큰. 기존 BFF 프록시의 30초 제한 안에서 오류를 반환한다.
- 이력은 최대 200개/100,000자다. 조용히 이전 지시를 잘라내지 않고 초과 시 새 대화를 안내한다.
- migration `20260914043718_add-product-ai-replies.sql`을 1단계 migration 이후 적용한다.
- PostgreSQL 통합 테스트는 모델을 대역으로 교체한다. 실제 유료 모델 요청이나 운영 DB 변경은 수행하지 않았다.
- 테스트는 메시지 복구, 소유권, 중복 응답, 실패 재시도, 동시 실행, 리스 만료 복구와 응답 잘림 처리를 검증한다.

### 채팅 UX / 중지 / 근거 (구현)

- [AI 채팅의 여백·스크롤 원리](https://velog.io/@k-svelte-master/ai-chatbot-ux)를 참고해 최신 질문/답변 묶음에
  뷰포트 한 칸의 최소 높이를 예약한다. 새 질문은 상단에 배치하고, 사용자가 이전 내용을 읽으면 끌어내리지 않는다.
  ResizeObserver로 패널 크기와 답변 높이를 관찰하고 `최신 답변`으로 하단 추적을 재개한다.
  현재 이력 상한이 200개라 가상 스크롤은 추가하지 않았다.
- 답변 복사, 좋아요/싫어요/취소를 제공한다. 평가 API는 본인 세션의 assistant 메시지만 갱신한다.
- 생성 중지 버튼/Esc는 스트림을 끊고 서버의 cancel API에도 전달한다. 현재 프로세스에서는 모델 요청을 abort한다.
  다른 인스턴스에서 생성 중이어도 DB lease를 무효화해 늦은 저장을 차단한다. 다른 인스턴스의 모델 요청은
  기존 20초 제한 내 종료하며, 별도 분산 취소 버스는 아직 없다.
- 중단된 조각은 브라우저에만 `저장되지 않음`으로 표시한다. 새로고침 후 이력에는 완성된 답변만 남는다.
- `packages/product-ai/guides.ts`의 버전별 운영 가이드를 질문 주제에 맞춰 모델에 제공하고,
  실제 제공한 가이드 스냅샷만 답변의 sources에 저장한다. UI는 `참고한 운영 가이드`라고 표시한다.
  모델이 생성한 임의 링크, 실시간 상품 조회, 웹 검색 출처를 가장하지 않는다.
- 가이드 원문: `/mall/product-ai/guide`. migration `20260914053345_product-ai-feedback-sources.sql`이 필요하다.
  이 migration은 테스트 전용 임시 DB에서 검증했으며 운영/공유 개발 DB에는 자동 적용하지 않는다.

## 2단계 B: AI의 첫 상품 작업 연결 (다음)

- 공통 채팅 패널과 전체보기 전환은 구현했다. 현재 화면/미저장 폼을 AI에 전달하는 기능은 아직 없다.
- Core의 AI 응답 처리에 실제 업무 도구를 연결한다.
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

### 대화 목록 관리

- 추천 질문은 초기 화면에서 3줄의 pill 버튼으로 천천히 흐른다. hover/focus 시 정지하며, reduced-motion에서는 정적으로 모두 표시한다.
- 대화 제목은 목록에서 편집하며 Enter로 저장, Esc로 취소한다. 서버는 소유자와 1~200자 제목을 검증한다.
- 삭제는 sessions.deleted_at 기반 소프트 삭제다. 목록/조회/메시지 추가/답변 생성/제목 수정에서 제외하며, 진행 중인 답변 lease를 해제해 늦은 저장을 차단한다.
- 메시지는 보존한다. 복구 UI 및 영구 삭제 보존기간 정책은 아직 구현하지 않았다.
- `20260914054932_product-ai-soft-delete.sql` 마이그레이션이 필요하다. 임시 테스트 DB에서 검증했으며 공유 DB에는 적용하지 않았다.


### OpenAI 연결

상품 AI 공급자는 OpenAI Responses API를 사용한다. `apps/core/.env`에 챗봇 전용 키를 설정하고 Core를 재시작한다.

```env
PRODUCT_AI_OPENAI_API_KEY=발급받은_챗봇_전용_키
PRODUCT_AI_MODEL=gpt-4.1-mini
```

검색 서비스의 키는 자동으로 재사용하지 않는다. 기본 모델은 gpt-4.1-mini, store:false로 호출한다. 기존 서버 20초 제한과 Esc 취소 전달을 유지한다. 실제 모델 이용 가능 여부는 발급 프로젝트 권한에 따라 확인해야 한다.
공식 API 지침: https://developers.openai.com/api/docs/guides/streaming-responses


### 이미지 첨부

- 기존 file-service 업로드를 재사용한다. `product-ai-image` 컨텍스트는 비공개 JPG/PNG/WebP만 허용하며 장당 5MB, 메시지당 4장, 대화당 12장·합계 20MB까지 지원한다.
- 사용자 메시지에는 검증된 파일 메타데이터만 저장한다. 사용자 인증을 file-service로 전달해 저장/모델 호출 시 읽기 권한을 확인한다. 인증 헤더는 이미지 저장소나 OpenAI로 전달하지 않는다.
- GPT에는 이미지 바이트를 `input_image`로 전달한다. 이전 첨부도 대화 이력에 포함하므로 후속 질문과 재시도에 사용할 수 있다. 상세페이지 미리보기와 상품 초안 저장 도구가 이 첨부 목록을 재사용한다.
- 입력창의 이미지 버튼·클립보드 붙여넣기·메시지 입력창에 파일 드래그앤드롭, 전송 전 미리보기·첨부 제거, 이미지 단독 전송을 지원한다. 드래그 중에는 입력창 내부에만 드롭 영역을 표시하고, 답변 생성·업로드 중에는 추가 첨부를 막는다. 첨부 제거는 현재 메시지에서 제외하는 동작이며 업로드 파일의 영구 삭제는 아니다.
- Core: `20260914065657_product-ai-image-attachments.sql`; file-service: `20260914065844_product-ai-image-context.sql` 마이그레이션 필요. 기본 컨텍스트 시드에도 추가했다.
- 로컬 Core/file-service DB에는 두 마이그레이션을 적용했다. Core 빌드, 양쪽 타입 검사, 관련 테스트 71개가 통과했다.
- 브라우저 실전송 검증은 미완료다. localhost:8002에서 S3 직접 업로드는 CORS 오류, 프록시 폴백은 브라우저 `ERR_ACCESS_DENIED`로 실패했다. 배포 환경은 업로드 origin의 S3 CORS 설정과 실제 파일 전송을 확인해야 한다. 이 작업에서 원격 버킷 설정이나 배포 환경은 변경하지 않았다.

- 첨부를 선택하면 업로드 전부터 썸네일을 표시한다. 파일별 실제 전송률은 원형 퍼센트로, 서버 확인은 저장 중 표시로 구분한다. 실패한 첨부는 개별 재시도/제거할 수 있고 미완료 첨부가 있으면 메시지를 전송하지 않는다. 직접 PUT과 프록시 폴백 모두 전송률을 지원하며, 프록시의 기존 401 토큰 갱신을 유지한다.

### 단계별 상품등록 대화

- 상품등록 준비 중에는 답변 한 번에 결정할 항목 하나만 묻고 사용자 답을 기다린다. 이미 받은 정보는 건너뛰며 한 번에 여러 정보를 제공해도 모두 반영한다.
- 중간에 용어를 물으면 설명한 뒤 해당 단계로 돌아온다. 모르는 항목은 미정으로 보존하며 일반 운영 질문에는 상품등록 절차를 강요하지 않는다.
- 시스템 지침으로 유도하는 대화 방식이다. 실제 등록 실행이나 서버에서 강제하는 단계 상태 머신을 추가한 것은 아니다.
- 실제 GPT 예시 대화에서 상품 종류 확인 → 상품명·옵션·판매가 일괄 반영 → 멤버십 가격 질문 → 용어 설명 후 질문 복귀를 확인했다.


### 상세페이지·SEO 미리보기와 상품 초안 저장

- Responses API의 `prepare_product_draft` 함수 도구로 상품명·설명·대표/부가 이미지·상세페이지 블록·SEO 제목/설명/키워드·운영 태그 제안을 생성한다. 도구는 미리보기만 준비하고 실제 상품 저장은 사용자의 저장 버튼으로 실행한다.
- 모델은 HTML이나 외부 이미지 URL을 전달하지 않는다. 텍스트는 이스케이프하고 이미지 ID는 해당 대화의 첨부 목록과 대조한다. 사용자 답변과 이미지에 포함된 임의 지시를 실행하는 도구는 없다.
- `POST /product-ai/sessions/:id/messages/:messageId/save-draft`: 소유자·삭제 여부·최신 대화 revision을 검증하고 상품 초안을 생성한다. 대화당 상품 한 건에 연결하며 동일 요청 재시도는 같은 ID를 반환한다. 이후 미리보기 저장은 연결된 내 draft 버전만 갱신한다. 기존 버전은 저장 중 행 잠금으로 발행과의 경합을 막는다.
- `ProductMastersService.createMaster/updateVersion`을 재사용한다. 가격·옵션·재고·카테고리는 설정하지 않으며 운영 태그는 등록된 태그 사전 선택이 필요하므로 제안으로만 표시한다. 발행 API는 호출하지 않는다.
- 저장 시 사용한 비공개 첨부만 사용자 인증으로 재검증해 `product-image` 공개 파일로 복사한다. 원본 채팅 첨부는 변경하지 않는다. 상세 HTML에는 공개 상품 이미지 URL을 저장한다. S3 복사 뒤 DB 저장이 실패하면 사용하지 않는 복사본이 남을 수 있으며 파일 정리 작업은 별도 과제다.
- `20260914073828_product-ai-draft-preview.sql`은 메시지의 `product_draft`와 세션의 `saved_product` 컬럼을 추가한다. 로컬 DB에 적용 완료, 배포 DB에는 별도 마이그레이션이 필요하다.
- Core 빌드·admin 타입 검사·관련 테스트 80개 통과. 실제 GPT 이미지 입력으로 미리보기를 생성하고 브라우저에서 저장 API 200과 상품 초안 링크를 확인했다. 검증용 `[연결 검증] 냥이 스티커` 초안은 발행하지 않았다.
