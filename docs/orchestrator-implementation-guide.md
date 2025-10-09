# Orchestrator Implementation Guide

> **작성일**: 2025-10-08
> **버전**: 1.0.0
> **상태**: 구현 준비
> **관련 문서**: [saga-orchestrator.md](./saga-orchestrator.md), [event-specifications.md](./event-specifications.md)

## 📋 목차

1. [개요](#개요)
2. [아키텍처 설계](#아키텍처-설계)
3. [Orchestrator 앱 구조](#orchestrator-앱-구조)
4. [Saga 구현 상세](#saga-구현-상세)
5. [워크플로우 예시](#워크플로우-예시)
6. [Phase별 구현 계획](#phase별-구현-계획)
7. [테스트 전략](#테스트-전략)

---

## 개요

### 목적

Almondyoung Server의 마이크로서비스(PIM, WMS, Channel Adapter) 간 분산 트랜잭션을 조율하기 위한 **전용 Orchestrator 마이크로서비스**를 구현합니다.

### 핵심 설계 원칙

1. **YAGNI (You Aren't Gonna Need It)**: Saga 로직을 별도 라이브러리(`libs/saga`)로 분리하지 않고 `apps/orchestrator` 내부에 구현
2. **Incremental Complexity**: Phase 1에서는 상태 영속화 없이 in-memory 실행, Phase 2에서 영속화 추가
3. **HTTP/REST 통신**: 독립 배포된 마이크로서비스 간 HTTP 기반 동기 호출
4. **Type Safety**: TypeScript 제네릭을 활용한 타입 안전한 워크플로우

### Saga Orchestrator vs Choreography

| 구분 | Orchestration (채택) | Choreography |
|------|---------------------|--------------|
| 조율 방식 | 중앙 Orchestrator가 순서 관리 | 각 서비스가 이벤트로 통신 |
| 트랜잭션 관리 | 명시적 보상 트랜잭션 실행 | 암묵적 이벤트 기반 롤백 |
| 복잡도 | 낮음 (중앙화) | 높음 (분산) |
| 디버깅 | 쉬움 | 어려움 |
| 적합성 | 복잡한 비즈니스 플로우 | 느슨한 결합 이벤트 |

---

## 아키텍처 설계

### 마이크로서비스 구성

```
┌─────────────────────────────────────────────────────────┐
│                  apps/orchestrator                      │
│  (Saga Coordinator - 워크플로우 조율 전담)                 │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Workflow: Unified Master Creation                │ │
│  │                                                   │ │
│  │  Step 1: Create PIM Master    ────────────────┐  │ │
│  │  Step 2: Create WMS Master    ────────────┐   │  │ │
│  │  Step 3: Create Product Matching ──────┐  │   │  │ │
│  └────────────────────────────────────────┼──┼───┼──┘ │
└────────────────────────────────────────────┼──┼───┼────┘
                                             │  │   │
                      ┌──────────────────────┘  │   │
                      │  ┌──────────────────────┘   │
                      │  │  ┌───────────────────────┘
                      ▼  ▼  ▼
        ┌─────────────────────────────────────────────┐
        │  HTTP/REST 통신                             │
        └─────────────────────────────────────────────┘
                      │  │  │
        ┌─────────────┘  │  └─────────────┐
        │                │                │
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────┐    ┌──────────────┐
  │   PIM    │    │   WMS    │    │   Channel    │
  │ Service  │    │ Service  │    │   Adapter    │
  └──────────┘    └──────────┘    └──────────────┘
  (Port 3001)     (Port 3002)     (Port 3003)
```

### 서비스별 역할

| 서비스 | 역할 | 통신 방식 | 상태 관리 |
|--------|------|----------|----------|
| **orchestrator** | 워크플로우 조율 | HTTP 클라이언트 (다른 서비스 호출) | Workflow 상태 (Phase 2) |
| **pim** | 상품 마스터/변형 관리 | HTTP 서버 (CRUD API 제공) | 도메인 상태만 관리 |
| **wms** | 재고/주문 이행 관리 | HTTP 서버 (CRUD API 제공) | 도메인 상태만 관리 |
| **channel-adapter** | 외부 채널 연동 | HTTP 서버 (Sync API 제공) | 동기화 상태 관리 |

### 통신 플로우 예시

```
User/Admin → POST /workflows/unified-master
                    ↓
            [orchestrator]
                    ↓
      ┌─────────────┴─────────────┐
      │ Step 1: Create PIM Master │
      │ POST pim:3001/api/masters │
      └─────────────┬─────────────┘
                    ↓
      ✅ Success: { masterId: "..." }
                    ↓
      ┌─────────────┴──────────────┐
      │ Step 2: Create WMS Master  │
      │ POST wms:3002/api/masters  │
      └─────────────┬──────────────┘
                    ↓
      ❌ Failure: Out of memory
                    ↓
      ┌─────────────┴──────────────┐
      │ Compensate Step 1          │
      │ DELETE pim:3001/masters/.. │
      └────────────────────────────┘
                    ↓
            Return Error to User
```

---

## Orchestrator 앱 구조

### 디렉토리 구조

```
apps/orchestrator/
├── src/
│   ├── saga/                              # Saga 프리미티브 (orchestrator 전용)
│   │   ├── create-step.ts                 # Step 정의 함수
│   │   ├── create-workflow.ts             # Workflow 조합 함수
│   │   ├── http-saga.orchestrator.ts      # HTTP 기반 Orchestrator 베이스 클래스
│   │   ├── saga.types.ts                  # 타입 정의
│   │   └── index.ts                       # Public exports
│   │
│   ├── workflows/                         # 구체적인 워크플로우 구현
│   │   ├── unified-master.workflow.ts     # PIM + WMS 마스터 생성
│   │   ├── order-fulfillment.workflow.ts  # 주문 이행 워크플로우
│   │   ├── inventory-sync.workflow.ts     # 재고 동기화 워크플로우
│   │   └── index.ts
│   │
│   ├── services/                          # 외부 서비스 API 클라이언트
│   │   ├── pim.api.service.ts             # PIM HTTP 클라이언트
│   │   ├── wms.api.service.ts             # WMS HTTP 클라이언트
│   │   ├── channel-adapter.api.service.ts # Channel Adapter 클라이언트
│   │   └── workflow-engine.service.ts     # 워크플로우 실행 엔진 (Phase 2)
│   │
│   ├── controllers/
│   │   ├── workflow.controller.ts         # 워크플로우 실행 API
│   │   └── monitoring.controller.ts       # 워크플로우 모니터링 (Phase 2)
│   │
│   ├── database/                          # Phase 2: 상태 영속화
│   │   └── schemas/
│   │       ├── orchestrator-schema.ts
│   │       └── workflow-executions.schema.ts
│   │
│   ├── orchestrator.module.ts
│   └── main.ts
│
├── drizzle.config.ts                      # Phase 2
├── tsconfig.app.json
└── README.md
```

### 주요 파일 설명

#### 1. `saga/create-step.ts`

Step 정의를 위한 팩토리 함수:

```typescript
export interface StepFunction<TInput, TOutput> {
  (input: TInput, context: SagaContext): Promise<StepResponse<TOutput>>;
}

export interface CompensateFunction<TRollbackData> {
  (rollbackData: TRollbackData, context: SagaContext): Promise<void>;
}

export class StepResponse<TData, TRollback = any> {
  constructor(
    public data: TData,
    public rollbackData?: TRollback,
  ) {}
}

export interface SagaStep<TInput, TOutput, TRollback> {
  name: string;
  execute: StepFunction<TInput, StepResponse<TOutput, TRollback>>;
  compensate?: CompensateFunction<TRollback>;
}

export function createStep<TInput, TOutput, TRollback = any>(
  name: string,
  execute: StepFunction<TInput, StepResponse<TOutput, TRollback>>,
  compensate?: CompensateFunction<TRollback>,
): SagaStep<TInput, TOutput, TRollback> {
  return { name, execute, compensate };
}
```

#### 2. `saga/http-saga.orchestrator.ts`

HTTP 통신을 담당하는 베이스 Orchestrator:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SagaStep, SagaContext } from './saga.types';

@Injectable()
export class HttpSagaOrchestrator {
  protected readonly logger: Logger;
  private steps: SagaStep<any, any, any>[] = [];
  private executedSteps: Array<{ step: SagaStep<any, any, any>; rollbackData: any }> = [];

  constructor(
    protected readonly httpService: HttpService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Step 추가
   */
  addStep<TInput, TOutput, TRollback>(
    step: SagaStep<TInput, TOutput, TRollback>,
  ): this {
    this.steps.push(step);
    return this;
  }

  /**
   * 워크플로우 실행
   */
  async execute<TContext extends SagaContext>(
    initialContext: TContext,
  ): Promise<TContext> {
    try {
      let context = { ...initialContext };

      for (const step of this.steps) {
        this.logger.log(`🔄 [Saga] Executing: ${step.name}`);

        const result = await step.execute(context.input, context);

        this.executedSteps.push({
          step,
          rollbackData: result.rollbackData || result.data,
        });

        // 다음 Step에서 사용할 수 있도록 context 업데이트
        context = { ...context, ...result.data };
      }

      this.logger.log('✅ [Saga] All steps completed successfully');
      return context;

    } catch (error) {
      this.logger.error('❌ [Saga] Error occurred, initiating rollback...', error);
      await this.rollback();
      throw error;
    }
  }

  /**
   * 보상 트랜잭션 실행 (역순)
   */
  private async rollback(): Promise<void> {
    for (const { step, rollbackData } of this.executedSteps.reverse()) {
      if (!step.compensate) {
        this.logger.warn(`⚠️  [Saga] No compensation for: ${step.name}`);
        continue;
      }

      try {
        this.logger.log(`🔙 [Saga] Compensating: ${step.name}`);
        await step.compensate(rollbackData, {});
      } catch (error) {
        this.logger.error(
          `❌ [Saga] Compensation failed for ${step.name}:`,
          error.message,
        );
        // Best-effort rollback: 실패해도 계속 진행
      }
    }
  }

  /**
   * HTTP 헬퍼 메서드
   */
  protected async httpPost<T>(url: string, data: any): Promise<T> {
    const response = await firstValueFrom(this.httpService.post<T>(url, data));
    return response.data;
  }

  protected async httpDelete(url: string): Promise<void> {
    await firstValueFrom(this.httpService.delete(url));
  }

  protected async httpGet<T>(url: string): Promise<T> {
    const response = await firstValueFrom(this.httpService.get<T>(url));
    return response.data;
  }
}
```

#### 3. `workflows/unified-master.workflow.ts`

구체적인 워크플로우 구현 예시:

```typescript
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpSagaOrchestrator } from '../saga/http-saga.orchestrator';
import { StepResponse } from '../saga/create-step';

export interface UnifiedMasterInput {
  name: string;
  brand?: string;
  optionGroups: Array<{
    name: string;
    values: string[];
  }>;
}

@Injectable()
export class UnifiedMasterWorkflow extends HttpSagaOrchestrator {
  private pimBaseUrl: string;
  private wmsBaseUrl: string;

  constructor(
    httpService: HttpService,
    private configService: ConfigService,
  ) {
    super(httpService);
    this.pimBaseUrl = this.configService.get('PIM_SERVICE_URL', 'http://localhost:3001');
    this.wmsBaseUrl = this.configService.get('WMS_SERVICE_URL', 'http://localhost:3002');
  }

  async createUnifiedMaster(input: UnifiedMasterInput) {
    this
      .addStep({
        name: 'create-pim-master',
        execute: async () => {
          const response = await this.httpPost<{ id: string; variantIds: string[] }>(
            `${this.pimBaseUrl}/api/masters`,
            {
              name: input.name,
              brand: input.brand,
              optionGroups: input.optionGroups,
            },
          );

          return new StepResponse(
            { pimMasterId: response.id, variantIds: response.variantIds },
            { pimMasterId: response.id }, // Rollback data
          );
        },
        compensate: async (rollback) => {
          await this.httpDelete(`${this.pimBaseUrl}/api/masters/${rollback.pimMasterId}`);
        },
      })
      .addStep({
        name: 'create-wms-master',
        execute: async (ctx) => {
          const response = await this.httpPost<{ id: string }>(
            `${this.wmsBaseUrl}/api/inventory/masters`,
            {
              name: input.name,
              masterCode: `M-${ctx.pimMasterId.slice(0, 8)}`,
              optionSchema: input.optionGroups,
            },
          );

          return new StepResponse(
            { wmsMasterId: response.id },
            { wmsMasterId: response.id },
          );
        },
        compensate: async (rollback) => {
          await this.httpDelete(`${this.wmsBaseUrl}/api/inventory/masters/${rollback.wmsMasterId}`);
        },
      })
      .addStep({
        name: 'create-product-matching',
        execute: async (ctx) => {
          await this.httpPost(
            `${this.wmsBaseUrl}/api/matchings`,
            {
              variantId: ctx.variantIds[0],
              masterId: ctx.wmsMasterId,
              strategy: 'variant',
            },
          );

          return new StepResponse({}, undefined); // No rollback needed (cascades)
        },
        compensate: async () => {
          // WMS 마스터 삭제 시 CASCADE되므로 별도 보상 불필요
        },
      });

    return this.execute({ input });
  }
}
```

#### 4. `controllers/workflow.controller.ts`

워크플로우 실행 REST API:

```typescript
import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UnifiedMasterWorkflow, UnifiedMasterInput } from '../workflows/unified-master.workflow';

@ApiTags('Workflows')
@Controller('workflows')
export class WorkflowController {
  private readonly logger = new Logger(WorkflowController.name);

  constructor(
    private readonly unifiedMasterWorkflow: UnifiedMasterWorkflow,
  ) {}

  @Post('unified-master')
  @ApiOperation({ summary: '통합 마스터 생성 (PIM + WMS)' })
  async createUnifiedMaster(@Body() input: UnifiedMasterInput) {
    this.logger.log(`📦 Unified Master Workflow 시작: ${input.name}`);

    try {
      const result = await this.unifiedMasterWorkflow.createUnifiedMaster(input);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error('❌ Workflow 실패:', error);
      throw error;
    }
  }
}
```

---

## Saga 구현 상세

### 타입 안전성

모든 Step은 TypeScript 제네릭을 활용하여 타입 안전성을 보장합니다:

```typescript
// Input, Output, Rollback 타입을 명시적으로 정의
const step = createStep<
  { orderId: string },           // TInput
  { fulfillmentId: string },     // TOutput
  { fulfillmentId: string }      // TRollback
>(
  'create-fulfillment',
  async (input) => {
    const result = await api.createFulfillment(input.orderId);
    return new StepResponse(
      { fulfillmentId: result.id },
      { fulfillmentId: result.id },
    );
  },
  async (rollback) => {
    await api.cancelFulfillment(rollback.fulfillmentId);
  },
);
```

### Context 전파

각 Step의 실행 결과는 다음 Step의 입력으로 전달됩니다:

```typescript
Step 1 Output: { pimMasterId: 'abc' }
                    ↓
Step 2 Input: { pimMasterId: 'abc' } ← 자동 전파
                    ↓
Step 2 Output: { wmsMasterId: 'xyz' }
                    ↓
Step 3 Input: { pimMasterId: 'abc', wmsMasterId: 'xyz' }
```

### 에러 처리

```typescript
try {
  // Step 1: 성공
  // Step 2: 성공
  // Step 3: 실패 (예외 발생)
} catch (error) {
  // 자동 Rollback:
  // Compensate Step 2 (역순)
  // Compensate Step 1
  throw error; // 사용자에게 에러 전파
}
```

### Best-Effort Rollback

보상 트랜잭션이 실패해도 나머지 보상을 계속 시도합니다:

```typescript
private async rollback() {
  const failures = [];

  for (const { step, rollbackData } of this.executedSteps.reverse()) {
    try {
      await step.compensate(rollbackData);
    } catch (error) {
      failures.push({ step: step.name, error: error.message });
      // 계속 진행 (Best-effort)
    }
  }

  if (failures.length > 0) {
    // 보상 실패 로깅 및 알림
    this.logger.error('⚠️  Compensation failures:', failures);
    // TODO: Slack/Email 알림
  }
}
```

---

## 워크플로우 예시

### 1. 통합 마스터 생성 워크플로우

```typescript
POST /workflows/unified-master
{
  "name": "나이키 에어맥스",
  "brand": "Nike",
  "optionGroups": [
    { "name": "색상", "values": ["Black", "White"] },
    { "name": "사이즈", "values": ["250", "260", "270"] }
  ]
}

// 내부 실행:
Step 1: PIM 마스터 생성 → masterId: "pim-123"
Step 2: WMS 마스터 생성 → wmsMasterId: "wms-456"
Step 3: Product Matching 생성 → matchingId: "match-789"

// 응답:
{
  "success": true,
  "data": {
    "pimMasterId": "pim-123",
    "wmsMasterId": "wms-456",
    "variantIds": ["var-1", "var-2", "var-3"]
  }
}
```

### 2. 주문 이행 워크플로우 (예시)

```typescript
// workflows/order-fulfillment.workflow.ts
export class OrderFulfillmentWorkflow extends HttpSagaOrchestrator {
  async execute(orderId: string) {
    this
      .addStep({
        name: 'reserve-stock',
        execute: async () => {
          const reservation = await this.wmsApi.reserveStock(orderId);
          return new StepResponse(reservation, { reservationId: reservation.id });
        },
        compensate: async (rollback) => {
          await this.wmsApi.releaseReservation(rollback.reservationId);
        },
      })
      .addStep({
        name: 'create-fulfillment',
        execute: async (ctx) => {
          const fulfillment = await this.wmsApi.createFulfillment({
            orderId,
            reservationId: ctx.reservationId,
          });
          return new StepResponse(fulfillment, { fulfillmentId: fulfillment.id });
        },
        compensate: async (rollback) => {
          await this.wmsApi.cancelFulfillment(rollback.fulfillmentId);
        },
      })
      .addStep({
        name: 'notify-customer',
        execute: async () => {
          await this.notificationApi.sendFulfillmentNotification(orderId);
          return new StepResponse({}, undefined);
        },
        compensate: async () => {
          // 알림은 보상 불필요
        },
      });

    return this.run({ orderId });
  }
}
```

---

## Phase별 구현 계획

### **Phase 1: MVP - In-Memory Orchestration** (1-2주)

**목표**: 상태 영속화 없이 기본 Saga 패턴 검증

#### 구현 항목:

1. **Orchestrator 앱 스캐폴딩**
   - `nest generate app orchestrator`
   - 기본 모듈/컨트롤러 구조 생성
   - `package.json` 스크립트 추가

2. **Saga 프리미티브 구현**
   - `src/saga/create-step.ts`
   - `src/saga/http-saga.orchestrator.ts`
   - `src/saga/saga.types.ts`

3. **API 클라이언트 서비스**
   - `src/services/pim.api.service.ts`
   - `src/services/wms.api.service.ts`
   - HttpService 기반, 재시도 로직 포함

4. **첫 번째 워크플로우**
   - `src/workflows/unified-master.workflow.ts`
   - PIM + WMS 마스터 생성 조율

5. **테스트**
   - Unit Tests: Step/Workflow 실행 로직
   - Integration Tests: Mock HTTP 서버 대상 테스트

**제약 사항**:
- ❌ 워크플로우 상태 영속화 없음
- ❌ Orchestrator 재시작 시 실행 중 워크플로우 손실
- ✅ 간단한 워크플로우에는 충분

**환경 변수**:
```bash
PIM_SERVICE_URL=http://localhost:3001
WMS_SERVICE_URL=http://localhost:3002
CHANNEL_ADAPTER_URL=http://localhost:3003
SAGA_TIMEOUT_MS=30000
```

---

### **Phase 2: State Persistence** (2-3주)

**목표**: 워크플로우 실행 상태 영속화 및 재시도 지원

#### 구현 항목:

1. **Database 스키마 추가**

```typescript
// database/schemas/workflow-executions.schema.ts
import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const workflow_executions = pgTable('workflow_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowName: varchar('workflow_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(), // running, completed, failed, compensating
  input: jsonb('input').notNull(),
  currentStep: varchar('current_step', { length: 255 }),
  executedSteps: jsonb('executed_steps').$type<Array<{ step: string; rollbackData: any }>>(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

2. **Workflow Engine Service**

```typescript
// services/workflow-engine.service.ts
@Injectable()
export class WorkflowEngineService {
  async executeWorkflow(name: string, input: any): Promise<string> {
    // 1. workflow_executions 레코드 생성 (status: running)
    // 2. Workflow 실행
    // 3. 각 Step 실행 후 executed_steps 업데이트
    // 4. 성공 시 status: completed
    // 5. 실패 시 status: compensating → failed
  }

  async resumeWorkflow(executionId: string): Promise<void> {
    // 1. workflow_executions 조회
    // 2. executed_steps부터 재시작
  }
}
```

3. **모니터링 API**

```typescript
// controllers/monitoring.controller.ts
@Controller('workflows/monitoring')
export class MonitoringController {
  @Get()
  async listExecutions(@Query() filter: ExecutionFilter) {
    // 워크플로우 실행 목록 조회
  }

  @Get(':id')
  async getExecution(@Param('id') id: string) {
    // 특정 실행 상세 조회
  }

  @Post(':id/retry')
  async retryExecution(@Param('id') id: string) {
    // 실패한 워크플로우 재시도
  }
}
```

**이점**:
- ✅ Orchestrator 재시작 후에도 워크플로우 복구 가능
- ✅ 실패한 워크플로우 재시도 지원
- ✅ 전체 워크플로우 실행 이력 추적

---

### **Phase 3: Advanced Features** (장기)

1. **병렬 Step 실행**
   - 독립적인 Step을 동시에 실행하여 성능 향상

2. **Saga Dashboard**
   - 실시간 워크플로우 상태 모니터링
   - 실패 워크플로우 알림

3. **Temporal 마이그레이션 검토**
   - 워크플로우가 10개 이상으로 증가 시
   - 장기 실행 워크플로우 필요 시

---

## 테스트 전략

### Unit Tests

```typescript
// workflows/unified-master.workflow.spec.ts
describe('UnifiedMasterWorkflow', () => {
  it('should execute all steps successfully', async () => {
    const workflow = new UnifiedMasterWorkflow(httpService, config);

    // Mock HTTP responses
    mockPimApi.createMaster.mockResolvedValue({ id: 'pim-123' });
    mockWmsApi.createMaster.mockResolvedValue({ id: 'wms-456' });

    const result = await workflow.createUnifiedMaster(input);

    expect(result.pimMasterId).toBe('pim-123');
    expect(result.wmsMasterId).toBe('wms-456');
  });

  it('should compensate on failure', async () => {
    mockPimApi.createMaster.mockResolvedValue({ id: 'pim-123' });
    mockWmsApi.createMaster.mockRejectedValue(new Error('WMS error'));

    await expect(workflow.createUnifiedMaster(input)).rejects.toThrow();

    // PIM 마스터 삭제 확인
    expect(mockPimApi.deleteMaster).toHaveBeenCalledWith('pim-123');
  });
});
```

### Integration Tests

```typescript
// workflows/unified-master.integration.spec.ts
describe('UnifiedMasterWorkflow Integration', () => {
  let pimServer: MockServer;
  let wmsServer: MockServer;

  beforeAll(async () => {
    pimServer = await startMockPimServer(3001);
    wmsServer = await startMockWmsServer(3002);
  });

  it('should call real HTTP endpoints', async () => {
    const result = await workflow.createUnifiedMaster(input);

    expect(pimServer.receivedRequests).toContainEqual(
      expect.objectContaining({ path: '/api/masters', method: 'POST' })
    );
  });
});
```

### E2E Tests

```typescript
// e2e/workflows.e2e-spec.ts
describe('Orchestrator E2E', () => {
  it('POST /workflows/unified-master', () => {
    return request(app.getHttpServer())
      .post('/workflows/unified-master')
      .send(input)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.pimMasterId).toBeDefined();
        expect(res.body.data.wmsMasterId).toBeDefined();
      });
  });
});
```

---

## 참고 자료

- [Saga Orchestrator 설계 문서](./saga-orchestrator.md)
- [Event Specifications](./event-specifications.md)
- [Transactional Outbox Pattern](./transactional-outbox-pattern.md)
- [Medusa Workflows SDK](https://docs.medusajs.com/resources/references/workflows)
- [Microsoft Saga Pattern](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)

---

## FAQ

### Q1: 왜 `libs/saga`로 분리하지 않나요?

**A**: YAGNI 원칙에 따라, 현재는 Orchestrator만 Saga를 사용합니다. 두 번째 서비스에서 Saga가 필요해지면 그때 리팩토링하는 것이 더 효율적입니다.

### Q2: HTTP 대신 gRPC나 Kafka를 사용할 수 있나요?

**A**: 가능하지만, 동기 트랜잭션 조율에는 HTTP/REST가 가장 간단합니다. gRPC는 디버깅이 복잡하고, Kafka는 비동기 통신에 적합합니다.

### Q3: Orchestrator가 SPOF(Single Point of Failure)가 되지 않나요?

**A**: Phase 2에서 상태를 DB에 저장하면, Orchestrator 인스턴스가 재시작되어도 워크플로우를 복구할 수 있습니다. 추가로 Orchestrator를 여러 인스턴스로 실행하여 고가용성을 확보할 수 있습니다.

### Q4: 보상 트랜잭션이 실패하면 어떻게 되나요?

**A**: Best-effort rollback을 수행하며, 실패한 보상은 로그에 기록하고 수동 개입이 필요하다는 알림을 발송합니다. Phase 2에서는 보상 실패 내역을 DB에 저장하여 재시도할 수 있습니다.

### Q5: Temporal을 처음부터 사용하는 것이 낫지 않나요?

**A**: Temporal은 강력하지만 학습 곡선이 높고 인프라 오버헤드가 있습니다. 초기에는 커스텀 구현으로 시작하여 요구사항을 명확히 파악한 후, 필요 시 Temporal로 마이그레이션하는 것이 더 안전합니다.

---

## 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|----------|
| 1.0.0 | 2025-10-08 | - | 초기 작성 |
