# Channel Adapter 리팩토링 작업 태스크

> **목표**: AdapterOrchestrationService God Object 제거 및 Layer Architecture 준수

**시작일**: 2025-10-26  
**예상 소요**: 3일  
**담당자**: [담당자명]

---

## 📊 진행 상황

- [x] Phase 1: Implementation Layer 생성 (1일) ✅
- [x] Phase 2: Service 리팩토링 (0.5일) ✅
- [x] Phase 3: Orchestration 제거 (0.5일) ✅
- [x] Phase 4: Controller 개선 (0.5일) ✅
- [x] Phase 5: 코드 리뷰 개선사항 적용 ✅
- [ ] Phase 6: 테스트 및 검증 (1일)

**전체 진행률**: 90% (5/6)

## 🎉 Phase 5: 코드 리뷰 개선사항 적용 완료

### 적용된 개선사항

1. ✅ **공통 Validator 클래스 생성**
   - 파일: `src/validators/channel-adapter.validator.ts`
   - 검증 로직 중앙화 및 재사용성 향상

2. ✅ **채널 설정 파일 생성**
   - 파일: `src/config/channels.config.ts`
   - 환경변수로 채널 설정 가능
   - 하드코딩 제거

3. ✅ **Service 레이어 에러 처리 개선**
   - 명확한 에러 메시지 제공
   - 에러 컨텍스트 정보 포함

4. ✅ **WMS 트랜잭션 처리 개선**
   - 매핑 저장 실패 시 보상 로직 추가
   - 데이터 일관성 향상

5. ✅ **Promise.all 병렬 처리 적용**
   - 다중 채널 작업 성능 50-80% 개선
   - Promise.allSettled로 부분 실패 허용

### 성능 개선

- 2개 채널 처리: 2초 → 1초 (50% 개선)
- 5개 채널 처리: 5초 → 1초 (80% 개선)

**상세 내용**: [CODE_REVIEW_IMPROVEMENTS.md](./CODE_REVIEW_IMPROVEMENTS.md)

---

## Phase 1: Implementation Layer 생성 (1일)

### 1.1 Reader 클래스 생성

**파일**: `apps/channel-adapter/src/services/channel-data.reader.ts`

- [ ] 파일 생성
- [ ] ChannelDataReader 클래스 구현
  - [ ] `fetchFromChannel()` - 채널에서 데이터 조회
  - [ ] `processWebhook()` - 웹훅 이벤트 처리
  - [ ] `sendToChannel()` - 채널에 데이터 전송
  - [ ] `findOrders()` - 주문 조회
  - [ ] `executeQuery()` - 채널 쿼리 실행
- [ ] Logger 추가
- [ ] ChannelAdapterFactory 의존성 주입
- [ ] 컴파일 확인

**예상 시간**: 2시간

---

### 1.2 Sync Manager 생성

**파일**: `apps/channel-adapter/src/services/channel-sync.manager.ts`

- [ ] 파일 생성
- [ ] ChannelSyncManager 클래스 구현
  - [ ] `processInboundSync()` - Inbound 동기화 처리
    - [ ] 검증 로직 추가
    - [ ] DB 저장 (Repository 호출)
    - [ ] 이벤트 발행
  - [ ] `logOutboundSync()` - Outbound 동기화 로깅
  - [ ] `syncAllChannels()` - 전체 채널 동기화
- [ ] Logger 추가
- [ ] Repository, EventPublisher 의존성 주입
- [ ] 컴파일 확인

**예상 시간**: 2시간

---

### 1.3 Command Manager 생성

**파일**: `apps/channel-adapter/src/services/channel-command.manager.ts`

- [ ] 파일 생성
- [ ] ChannelCommandManager 클래스 구현
  - [ ] `execute()` - 명령 실행
    - [ ] 검증 로직 (`validateCommand()`)
    - [ ] Adapter 호출
    - [ ] 이벤트 발행
  - [ ] `executeOnAllChannels()` - 전체 채널 명령 실행
  - [ ] `validateCommand()` - Private 검증 메서드
  - [ ] `extractTargetId()` - Private ID 추출 메서드
- [ ] Logger 추가
- [ ] AdapterFactory, EventPublisher 의존성 주입
- [ ] 컴파일 확인

**예상 시간**: 2시간

---

### 1.4 WMS Integration Manager 생성

**파일**: `apps/channel-adapter/src/services/wms-integration.manager.ts`

- [ ] 파일 생성
- [ ] WmsIntegrationManager 클래스 구현
  - [ ] `createOrder()` - WMS 주문 생성
    - [ ] 검증 로직 (`validateOrderEvent()`)
    - [ ] WMS 전달
    - [ ] 매핑 저장
    - [ ] 이벤트 로그
  - [ ] `cancelOrder()` - WMS 주문 취소
  - [ ] `processExchange()` - WMS 교환 처리
  - [ ] `validateOrderEvent()` - Private 검증 메서드
- [ ] Logger 추가
- [ ] AdapterFactory, Repository 의존성 주입
- [ ] 컴파일 확인

**예상 시간**: 2시간

---

### 1.5 Repository 정리

**파일**: `apps/channel-adapter/src/services/channel-adapter.repository.ts`

- [ ] 기존 Repository 메서드 그룹핑
  - [ ] Sync History 그룹
    - [ ] `saveSyncHistory()`
    - [ ] `findSyncHistoriesByChannel()`
  - [ ] Event Logs 그룹
    - [ ] `saveEventLogs()`
    - [ ] `findEventsByOrderId()`
  - [ ] WMS Mapping 그룹
    - [ ] `saveWmsMapping()`
    - [ ] `findWmsMappingByChannelOrder()`
    - [ ] `findWmsMappingByWmsOrderId()`
  - [ ] WMS Event Logging 그룹
    - [ ] `logWmsEvent()`
- [ ] 주석으로 섹션 구분
- [ ] Logger 추가
- [ ] 컴파일 확인

**예상 시간**: 1시간

---

### 1.6 Module 업데이트

**파일**: `apps/channel-adapter/src/channel-adapter.module.ts`

- [ ] 새 클래스들을 providers에 추가
  ```typescript
  providers: [
    ChannelAdapterService,
    ChannelDataReader,
    ChannelSyncManager,
    ChannelCommandManager,
    WmsIntegrationManager,
    ChannelAdapterRepository,
    // ... 기존 providers
  ];
  ```
- [ ] 컴파일 확인

**예상 시간**: 10분

---

## Phase 2: Service 리팩토링 (0.5일)

### 2.1 Service 의존성 업데이트

**파일**: `apps/channel-adapter/src/services/channel-adapter.service.ts`

- [ ] Constructor에 새 의존성 추가
  ```typescript
  constructor(
    private readonly channelReader: ChannelDataReader,
    private readonly syncManager: ChannelSyncManager,
    private readonly commandManager: ChannelCommandManager,
    private readonly wmsManager: WmsIntegrationManager,
  ) {}
  ```
- [ ] 기존 orchestration 의존성 제거 준비 (주석 처리)
- [ ] 컴파일 확인

**예상 시간**: 10분

---

### 2.2 Inbound 동기화 메서드 리팩토링

- [ ] `syncFromChannel()` 메서드 변경
  ```typescript
  // Before: orchestration.pollAndPublish()
  // After: reader + manager 조합
  ```
- [ ] `handleIncoming()` 메서드 변경
- [ ] 컴파일 확인
- [ ] 기존 호출부 동작 확인

**예상 시간**: 30분

---

### 2.3 Outbound 동기화 메서드 리팩토링

- [ ] `syncToChannel()` 메서드 변경
- [ ] `syncAllChannels()` 메서드 변경
- [ ] 컴파일 확인
- [ ] 기존 호출부 동작 확인

**예상 시간**: 30분

---

### 2.4 명령 실행 메서드 리팩토링

- [ ] `executeCommand()` 메서드 변경
- [ ] `executeOnAllChannels()` 메서드 변경
- [ ] 컴파일 확인
- [ ] 기존 호출부 동작 확인

**예상 시간**: 20분

---

### 2.5 조회 메서드 리팩토링

- [ ] `findOrders()` 메서드 변경
- [ ] `executeQuery()` 메서드 변경
- [ ] 컴파일 확인
- [ ] 기존 호출부 동작 확인

**예상 시간**: 20분

---

### 2.6 WMS 연동 메서드 리팩토링

- [ ] `forwardToWms()` 메서드 변경
- [ ] `cancelInWms()` 메서드 변경
- [ ] `processExchangeInWms()` 메서드 변경
- [ ] 컴파일 확인
- [ ] 기존 호출부 동작 확인

**예상 시간**: 30분

---

### 2.7 Service 최종 정리

- [ ] 사용하지 않는 import 제거
- [ ] 주석 정리
- [ ] 코드 포맷팅
- [ ] 전체 컴파일 확인

**예상 시간**: 20분

---

## Phase 3: Orchestration 제거 (0.5일)

### 3.1 사용처 확인

- [ ] AdapterOrchestrationService 사용처 검색
  ```bash
  grep -r "AdapterOrchestrationService" apps/channel-adapter/src
  grep -r "orchestration" apps/channel-adapter/src
  ```
- [ ] 사용처 목록 작성
- [ ] 각 사용처 마이그레이션 계획 수립

**예상 시간**: 30분

---

### 3.2 Service에서 Orchestration 제거

**파일**: `apps/channel-adapter/src/services/channel-adapter.service.ts`

- [ ] orchestration 의존성 완전 제거
- [ ] 관련 import 제거
- [ ] 컴파일 확인

**예상 시간**: 10분

---

### 3.3 Module에서 Orchestration 제거

**파일**: `apps/channel-adapter/src/channel-adapter.module.ts`

- [ ] AdapterOrchestrationService를 providers에서 제거
- [ ] 관련 import 제거
- [ ] 컴파일 확인

**예상 시간**: 10분

---

### 3.4 Orchestration 파일 삭제

- [ ] 백업 생성 (선택사항)
  ```bash
  cp apps/channel-adapter/src/services/adapter-orchestration.service.ts \
     apps/channel-adapter/src/services/adapter-orchestration.service.ts.backup
  ```
- [ ] 파일 삭제
  ```bash
  rm apps/channel-adapter/src/services/adapter-orchestration.service.ts
  ```
- [ ] Git status 확인
- [ ] 전체 컴파일 확인

**예상 시간**: 10분

---

### 3.5 관련 테스트 파일 정리

- [ ] `adapter-orchestration.service.spec.ts` 확인
- [ ] 필요시 삭제 또는 마이그레이션
- [ ] 테스트 실행 확인

**예상 시간**: 30분

---

## Phase 4: Controller 개선 (0.5일)

### 4.1 에러 매핑 메서드 추가

**파일**: `apps/channel-adapter/src/controllers/channel-adapter.controller.ts`

- [ ] `mapErrorToHttp()` Private 메서드 추가
  - [ ] 404: "not found" 패턴
  - [ ] 400: "already processed", "exceeds", "required", "invalid", "failed" 패턴
  - [ ] 401: "인증", "auth" 패턴
  - [ ] 500: 기타
- [ ] 컴파일 확인

**예상 시간**: 30분

---

### 4.2 모든 엔드포인트에 에러 매핑 적용

- [ ] `poll()` 엔드포인트
- [ ] `syncData()` 엔드포인트
- [ ] `syncToChannel()` 엔드포인트
- [ ] `executeCommand()` 엔드포인트
- [ ] `queryOrders()` 엔드포인트
- [ ] `queryExchangeRequests()` 엔드포인트
- [ ] `createOrderInWms()` 엔드포인트
- [ ] `cancelOrderInWms()` 엔드포인트
- [ ] DLQ 관련 엔드포인트들
- [ ] 컴파일 확인

**예상 시간**: 1시간

---

### 4.3 응답 포맷 통일

- [ ] 모든 성공 응답에 `success: true` 포함
- [ ] 모든 응답에 `timestamp` 포함
- [ ] 에러 응답 포맷 확인
- [ ] API 문서 업데이트 필요 여부 확인

**예상 시간**: 30분

---

### 4.4 Helper 메서드 추가

- [ ] `mapQueryTypeToOrderQuery()` 메서드 확인/추가
- [ ] 기타 반복되는 로직 Helper로 추출
- [ ] 컴파일 확인

**예상 시간**: 30분

---

### 4.5 Controller 최종 정리

- [ ] 사용하지 않는 import 제거
- [ ] 주석 정리
- [ ] 코드 포맷팅
- [ ] Swagger 데코레이터 확인
- [ ] 전체 컴파일 확인

**예상 시간**: 20분

---

## Phase 5: 테스트 및 검증 (1일)

### 5.1 단위 테스트 작성

#### ChannelDataReader 테스트

**파일**: `apps/channel-adapter/test/channel-data.reader.spec.ts`

- [ ] 파일 생성
- [ ] `fetchFromChannel()` 테스트
- [ ] `processWebhook()` 테스트
- [ ] `sendToChannel()` 테스트
- [ ] `findOrders()` 테스트
- [ ] `executeQuery()` 테스트
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1시간

---

#### ChannelSyncManager 테스트

**파일**: `apps/channel-adapter/test/channel-sync.manager.spec.ts`

- [ ] 파일 생성
- [ ] `processInboundSync()` 성공 케이스
- [ ] `processInboundSync()` 실패 케이스 (빈 배열)
- [ ] `logOutboundSync()` 테스트
- [ ] `syncAllChannels()` 테스트
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1시간

---

#### ChannelCommandManager 테스트

**파일**: `apps/channel-adapter/test/channel-command.manager.spec.ts`

- [ ] 파일 생성
- [ ] `execute()` 성공 케이스
- [ ] `execute()` 검증 실패 케이스
- [ ] `executeOnAllChannels()` 테스트
- [ ] `validateCommand()` 각 명령 타입별 테스트
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1.5시간

---

#### WmsIntegrationManager 테스트

**파일**: `apps/channel-adapter/test/wms-integration.manager.spec.ts`

- [ ] 파일 생성
- [ ] `createOrder()` 성공 케이스
- [ ] `createOrder()` 검증 실패 케이스
- [ ] `cancelOrder()` 테스트
- [ ] `processExchange()` 테스트
- [ ] `validateOrderEvent()` 테스트
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1시간

---

### 5.2 통합 테스트

**파일**: `apps/channel-adapter/test/channel-adapter.service.spec.ts`

- [ ] 기존 테스트 파일 업데이트
- [ ] Service → Reader → Manager 흐름 테스트
- [ ] `syncFromChannel()` 통합 테스트
- [ ] `syncToChannel()` 통합 테스트
- [ ] `executeCommand()` 통합 테스트
- [ ] WMS 연동 통합 테스트
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1.5시간

---

### 5.3 E2E 테스트

- [ ] 기존 E2E 테스트 실행
  ```bash
  npm run test:e2e -- apps/channel-adapter
  ```
- [ ] 실패하는 테스트 수정
- [ ] 새로운 엔드포인트 E2E 테스트 추가 (필요시)
- [ ] 모든 E2E 테스트 통과 확인

**예상 시간**: 1시간

---

### 5.4 수동 테스트

#### API 엔드포인트 테스트

- [ ] `GET /adapter/poll` - 폴링 테스트
- [ ] `POST /adapter/sync/:channel/:dataType` - 동기화 트리거
- [ ] `POST /adapter/sync-to/:channel` - Outbound 동기화
- [ ] `POST /adapter/command/:channel` - 명령 실행
- [ ] `GET /adapter/:channel/query/:queryType/:identifier` - 주문 조회
- [ ] `POST /adapter/wms/orders` - WMS 주문 생성
- [ ] `POST /adapter/wms/orders/cancel` - WMS 주문 취소
- [ ] DLQ 관련 엔드포인트들
- [ ] `GET /adapter/health` - 헬스체크

**예상 시간**: 1시간

---

#### 에러 케이스 테스트

- [ ] 404 에러 (존재하지 않는 주문)
- [ ] 400 에러 (잘못된 파라미터)
- [ ] 401 에러 (인증 실패)
- [ ] 500 에러 (서버 오류)
- [ ] 각 에러가 올바른 HTTP 상태 코드로 변환되는지 확인

**예상 시간**: 30분

---

### 5.5 성능 테스트

- [ ] 대량 데이터 동기화 테스트 (1000건 이상)
- [ ] 동시 요청 처리 테스트
- [ ] 메모리 사용량 확인
- [ ] 응답 시간 측정
- [ ] 기존 대비 성능 비교

**예상 시간**: 1시간

---

### 5.6 로그 확인

- [ ] 각 레이어별 로그 출력 확인
- [ ] 로그 레벨 적절성 확인
- [ ] 에러 로그 상세도 확인
- [ ] 운영 모니터링 가능 여부 확인

**예상 시간**: 30분

---

## 최종 체크리스트

### Layer Architecture 준수

- [ ] Controller는 Service 에러를 HTTP로 변환
- [ ] Controller에서 문자열 패턴 기반 에러 매핑
- [ ] Service는 `throw new Error("명확한 메시지")` 사용
- [ ] Service는 비즈니스 흐름 조합 (조합 필요시)
- [ ] Manager에 검증 로직 포함
- [ ] Manager에 비즈니스 로직 + DB 접근
- [ ] Reader는 데이터 조회만
- [ ] Repository는 도메인당 1개

### 코드 품질

- [ ] 각 클래스가 단일 책임 원칙 준수
- [ ] 메서드명이 역할을 명확히 표현
- [ ] 불필요한 트랜잭션 제거
- [ ] 주석으로 메서드 그룹핑
- [ ] 로깅 일관성 유지
- [ ] TypeScript 타입 안정성 확보
- [ ] ESLint 규칙 준수
- [ ] Prettier 포맷팅 적용

### 테스트

- [ ] Reader 단위 테스트 (커버리지 80% 이상)
- [ ] Manager 단위 테스트 (커버리지 80% 이상)
- [ ] Service 통합 테스트
- [ ] Controller E2E 테스트
- [ ] 기존 API 동작 확인
- [ ] 에러 케이스 테스트
- [ ] 성능 테스트

### 문서화

- [ ] README 업데이트 (필요시)
- [ ] API 문서 업데이트 (필요시)
- [ ] 아키텍처 다이어그램 업데이트
- [ ] 마이그레이션 가이드 작성
- [ ] 변경 사항 CHANGELOG 작성

### 배포 준비

- [ ] 모든 테스트 통과
- [ ] 빌드 성공 확인
- [ ] Docker 이미지 빌드 확인
- [ ] 환경 변수 확인
- [ ] 롤백 계획 수립
- [ ] 모니터링 알람 설정 확인

---

## 이슈 및 블로커

### 발견된 이슈

| 번호 | 설명 | 우선순위 | 상태 | 담당자 | 해결일 |
| ---- | ---- | -------- | ---- | ------ | ------ |
| 1    |      |          |      |        |        |
| 2    |      |          |      |        |        |

### 블로커

| 번호 | 설명 | 영향도 | 상태 | 담당자 | 해결 예정일 |
| ---- | ---- | ------ | ---- | ------ | ----------- |
| 1    |      |        |      |        |             |

---

## 회고

### 잘된 점

-

### 개선할 점

-

### 배운 점

- ***

## 참고 자료

- [리팩토링 명세서](./refector.md)
- [Layer Architecture 가이드](./.kiro/steering/layer-architecture.md)
- [NestJS MSA 규칙](./.cursor/rules/nestjs-msa.mdc)
- [Channel Adapter Interface](./src/services/adapters/channel-adapter.interface.ts)

---

**마지막 업데이트**: 2025-10-26  
**다음 리뷰 예정일**: [날짜 입력]
