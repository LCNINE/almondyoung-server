# Saga Orchestrator 설계 문서

## 개요

Almondyoung Server는 PIM, WMS 등 독립적으로 배포되는 마이크로서비스들을 조율하기 위해 **Saga Pattern 기반의 Orchestrator**를 사용합니다. 이 문서는 Medusa Workflows SDK에서 영감을 받은 커스텀 Saga 구현체에 대해 설명합니다.

## Saga Pattern이란?

Saga Pattern은 마이크로서비스 환경에서 분산 트랜잭션을 관리하는 패턴입니다. 각 서비스의 로컬 트랜잭션을 순차적으로 실행하고, 실패 시 보상 트랜잭션(Compensation)을 역순으로 실행하여 일관성을 유지합니다.

### Orchestration vs Choreography

- **Choreography**: 각 서비스가 이벤트를 발행/구독하며 분산된 방식으로 조율
- **Orchestration** (본 시스템 채택): 중앙 Orchestrator가 서비스 호출 순서와 보상 로직을 관리

## Medusa 스타일 구현

### 핵심 개념

Medusa의 Workflows SDK는 다음과 같은 패턴을 제공합니다:

1. **`createStep`**: Step 정의 함수
   - Step 이름
   - 실행 함수 (execute)
   - 보상 함수 (compensate)

2. **`createWorkflow`**: 여러 Step을 조합한 워크플로우 정의

3. **`StepResponse`**: 실행 결과와 Rollback 데이터를 함께 반환

### Medusa 예시 코드

```typescript
import { createStep, createWorkflow, StepResponse } from "@medusajs/workflows-sdk"

const createProductStep = createStep(
  "create-product",
  async (input, context) => {
    const product = await context.container.resolve("productService").create(input)
    return new StepResponse(product, { productId: product.id })
  },
  async (rollbackData, context) => {
    await context.container.resolve("productService").delete(rollbackData.productId)
  }
)

export const createProductWorkflow = createWorkflow(
  "create-product-workflow",
  (input) => {
    const product = createProductStep(input.product)
    const inventory = createInventoryStep({
      productId: product.id,
      ...input.inventory
    })
    return { product, inventory }
  }
)
```

## 커스텀 구현

### 라이브러리 구조 (`libs/saga`)

#### 1. `create-step.ts`

```typescript
interface StepFunction<TInput, TOutput> {
  (input: TInput, context: SagaContext): Promise<TOutput>
}

interface CompensateFunction<TRollbackData> {
  (rollbackData: TRollbackData, context: SagaContext): Promise<void>
}

export class StepResponse<TData, TRollback = any> {
  constructor(
    public data: TData,
    public rollbackData?: TRollback,
  ) {}
}

export function createStep<TInput, TOutput, TRollback = any>(
  name: string,
  execute: StepFunction<TInput, StepResponse<TOutput, TRollback>>,
  compensate?: CompensateFunction<TRollback>,
) {
  return {
    name,
    execute,
    compensate,
  }
}
```

#### 2. `create-workflow.ts`

```typescript
export function createWorkflow<TInput, TOutput>(
  name: string,
  definition: (input: TInput) => Promise<TOutput>,
) {
  return async (input: TInput, context: SagaContext = {}): Promise<TOutput> => {
    const executedSteps: any[] = []

    try {
      context._recordStep = (step: any, data: any) => {
        executedSteps.push({ step, rollbackData: data })
      }

      const result = await definition(input)
      return result
    } catch (error) {
      // Rollback in reverse order
      for (const { step, rollbackData } of executedSteps.reverse()) {
        if (step.compensate && rollbackData) {
          await step.compensate(rollbackData, context)
        }
      }
      throw error
    }
  }
}
```

#### 3. `http-saga.orchestrator.ts` - HTTP 기반 실행기

```typescript
import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

interface SagaStep {
  name: string
  execute: (context: any) => Promise<any>
  compensate: (rollbackData: any) => Promise<void>
}

@Injectable()
export class HttpSagaOrchestrator {
  private steps: SagaStep[] = []
  private executedSteps: Array<{ step: SagaStep; rollbackData: any }> = []

  constructor(private readonly httpService: HttpService) {}

  addStep(step: SagaStep) {
    this.steps.push(step)
    return this
  }

  async execute(initialContext: any) {
    try {
      let context = { ...initialContext }

      for (const step of this.steps) {
        console.log(`[Saga] Executing: ${step.name}`)
        const result = await step.execute(context)

        this.executedSteps.push({
          step,
          rollbackData: result.rollbackData || result
        })

        context = { ...context, ...result }
      }

      console.log('[Saga] ✅ All steps completed')
      return context

    } catch (error) {
      console.error('[Saga] ❌ Error occurred, rolling back...')
      await this.rollback()
      throw error
    }
  }

  private async rollback() {
    for (const { step, rollbackData } of this.executedSteps.reverse()) {
      try {
        console.log(`[Saga] Compensating: ${step.name}`)
        await step.compensate(rollbackData)
      } catch (error) {
        console.error(`[Saga] Failed to compensate ${step.name}:`, error.message)
      }
    }
  }

  protected async httpPost(url: string, data: any) {
    return firstValueFrom(this.httpService.post(url, data))
  }

  protected async httpDelete(url: string) {
    return firstValueFrom(this.httpService.delete(url))
  }
}
```

### 사용 예시: 통합 마스터 생성 워크플로우

```typescript
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpSagaOrchestrator } from '@app/saga'

@Injectable()
export class UnifiedMasterWorkflow extends HttpSagaOrchestrator {
  private pimBaseUrl: string
  private wmsBaseUrl: string

  constructor(
    httpService: HttpService,
    configService: ConfigService,
  ) {
    super(httpService)
    this.pimBaseUrl = configService.get('PIM_SERVICE_URL') // http://pim-service:3001
    this.wmsBaseUrl = configService.get('WMS_SERVICE_URL') // http://wms-service:3002
  }

  async createUnifiedMaster(input: UnifiedMasterInput) {
    this
      .addStep({
        name: 'create-pim-master',
        execute: async (ctx) => {
          const response = await this.httpPost(`${this.pimBaseUrl}/api/masters`, {
            name: input.name,
            brand: input.brand,
            optionGroups: input.options,
          })
          return {
            pimMasterId: response.data.id,
            variantIds: response.data.variantIds,
            rollbackData: { pimMasterId: response.data.id },
          }
        },
        compensate: async (rollback) => {
          await this.httpDelete(`${this.pimBaseUrl}/api/masters/${rollback.pimMasterId}`)
        },
      })
      .addStep({
        name: 'create-wms-master',
        execute: async (ctx) => {
          const response = await this.httpPost(`${this.wmsBaseUrl}/api/inventory/masters`, {
            name: input.name,
            masterCode: `M-${ctx.pimMasterId.slice(0, 8)}`,
            optionSchema: input.options,
          })
          return {
            wmsMasterId: response.data.id,
            rollbackData: { wmsMasterId: response.data.id },
          }
        },
        compensate: async (rollback) => {
          await this.httpDelete(`${this.wmsBaseUrl}/api/inventory/masters/${rollback.wmsMasterId}`)
        },
      })
      .addStep({
        name: 'create-product-matching',
        execute: async (ctx) => {
          await this.httpPost(`${this.wmsBaseUrl}/api/matchings`, {
            variantId: ctx.variantIds[0],
            masterId: ctx.wmsMasterId,
            strategy: 'variant',
          })
          return {}
        },
        compensate: async () => {
          // 매칭은 WMS 마스터 삭제 시 CASCADE되므로 별도 보상 불필요
        },
      })

    return this.execute({ input })
  }
}
```

## 서비스 간 통신 방식

### HTTP/REST 선택 이유

독립적으로 배포되는 PIM/WMS 서비스와 통신하기 위해 **HTTP/REST**를 선택했습니다.

**장점:**
- 간단하고 직관적
- 디버깅 용이
- 인프라 추가 불필요
- 타임아웃 제어 가능

**대안과 비교:**
- **gRPC**: 성능은 좋으나 디버깅 복잡
- **Kafka**: 비동기 이벤트에는 적합하나 동기 트랜잭션에는 부적합
- **메시지 큐 (RabbitMQ)**: Request-Reply 패턴 구현이 복잡

## 단계별 구현 계획

### Phase 1: 기본 HTTP Saga 구현 (현재)
- `HttpSagaOrchestrator` 구현
- Step 정의 및 보상 로직
- 통합 마스터 생성 워크플로우

### Phase 2: 상태 영속화
- `workflow_executions` 테이블 추가
- 각 Step 실행 기록 저장
- 실패 시 재시도 로직

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY,
  workflow_name VARCHAR(255),
  status VARCHAR(50), -- running, completed, failed, compensating
  input JSONB,
  current_step VARCHAR(255),
  executed_steps JSONB,
  error_message TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Phase 3: 모니터링 및 고급 기능
- Workflow 실행 대시보드
- 부분 재시도 (특정 Step부터 재실행)
- 병렬 Step 실행 지원
- (선택) Temporal 마이그레이션 검토

## Temporal Workflow Engine

**Temporal**은 Uber가 개발한 오픈소스 분산 워크플로우 오케스트레이션 플랫폼입니다 (JavaScript의 Date 대체재인 Temporal API와는 다름).

### Temporal 특징
- 자동 재시도 및 타임아웃 관리
- 상태 자동 영속화
- 워크플로우 버전 관리
- 시각화 대시보드

### Temporal vs 커스텀 구현

| 항목 | 커스텀 구현 | Temporal |
|------|------------|----------|
| 인프라 | 불필요 | Temporal Server 필요 |
| 학습 곡선 | 낮음 | 높음 |
| 유연성 | 높음 | 제한적 |
| 기능 | 기본적 | 엔터프라이즈급 |
| 적합 시점 | 초기/중소규모 | 대규모/복잡한 워크플로우 |

### 마이그레이션 고려 시점
- 워크플로우가 10개 이상
- 장기 실행 워크플로우 필요 (수일~수개월)
- 복잡한 재시도/타임아웃 정책 필요
- 워크플로우 모니터링/관찰성 요구

## 장애 처리

### 보상 트랜잭션 실패 시

```typescript
private async rollback() {
  const failures = []

  for (const { step, rollbackData } of this.executedSteps.reverse()) {
    try {
      await step.compensate(rollbackData)
    } catch (error) {
      failures.push({ step: step.name, error: error.message })
      // 계속 진행 (Best-effort rollback)
    }
  }

  if (failures.length > 0) {
    // Alert 발송 또는 수동 개입 필요
    await this.notifyCompensationFailures(failures)
  }
}
```

### 타임아웃 처리

```typescript
async execute(initialContext: any, timeoutMs = 30000) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Workflow timeout')), timeoutMs)
  })

  return Promise.race([
    this.executeSteps(initialContext),
    timeoutPromise,
  ])
}
```

## 환경 변수 설정

```env
# .env
PIM_SERVICE_URL=http://pim-service:3001
WMS_SERVICE_URL=http://wms-service:3002
SAGA_TIMEOUT_MS=30000
SAGA_RETRY_ATTEMPTS=3
```

## 참고 자료

- [Medusa Workflows SDK Documentation](https://docs.medusajs.com/resources/references/workflows)
- [Saga Pattern - Microsoft](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)
- [Temporal Workflow Engine](https://temporal.io/)

## 결론

본 시스템의 Saga Orchestrator는:
1. Medusa의 직관적인 API 디자인을 차용
2. HTTP 기반으로 독립 배포된 서비스 조율
3. 자동 보상 트랜잭션으로 일관성 보장
4. 단계적 확장 가능 (영속화 → Temporal 마이그레이션)

향후 워크플로우가 복잡해지면 Temporal 등 산업 표준 솔루션 도입을 검토할 수 있습니다.
