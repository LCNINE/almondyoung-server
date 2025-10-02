# Graceful Shutdown 가이드

## 개요

애플리케이션 종료 시 Kafka producer/consumer를 안전하게 종료하여 **메시지 손실을 방지**합니다.

## 주요 기능

- ✅ **자동 활성화**: EventsModule 사용 시 자동으로 등록됨
- ✅ **In-flight 메시지 보호**: 처리 중인 메시지 완료 대기
- ✅ **타임아웃 설정**: 최대 30초 대기 (기본값)
- ✅ **에러 핸들링**: 종료 실패 시에도 안전하게 종료
- ✅ **상세한 로깅**: 종료 과정 추적 가능

## 작동 원리

```
1. 애플리케이션 종료 신호 수신 (SIGTERM, SIGINT 등)
           ↓
2. GracefulShutdownService.onApplicationShutdown() 호출
           ↓
3. Kafka producer 종료 (미전송 메시지 flush)
           ↓
4. Kafka consumer 종료 (처리 중인 메시지 완료)
           ↓
5. 모든 연결 종료
           ↓
6. 애플리케이션 종료
```

## 자동 설정 (기본)

EventsModule을 사용하면 **자동으로 graceful shutdown이 활성화**됩니다.

### Publisher 사용 시

```typescript
// apps/wms/src/order/order.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [ORDER_STREAM],
      serviceName: 'wms-order',
    }),
    // ✅ GracefulShutdownService가 자동으로 등록됨!
  ],
})
export class OrderModule {}
```

### Consumer 사용 시

```typescript
// apps/channel-adapter/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@app/shared/streams/orders.stream';

@Module({
  imports: [
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'channel-adapter-consumers',
    }),
    // ✅ GracefulShutdownService가 자동으로 등록됨!
  ],
})
export class AppModule {}
```

## 실행 예시

### 정상 종료

```bash
$ node dist/main.js
[EventsModule] Kafka connected
[OrderService] Application started

# Ctrl+C 또는 SIGTERM 신호
^C
[GracefulShutdownService] 🛑 Graceful shutdown initiated (signal: SIGTERM)
[GracefulShutdownService] Disconnecting Kafka client...
[GracefulShutdownService] ✅ Kafka client disconnected
[GracefulShutdownService] ✅ Graceful shutdown completed
[NestApplication] Application terminated
```

### 타임아웃 발생

```bash
^C
[GracefulShutdownService] 🛑 Graceful shutdown initiated (signal: SIGINT)
[GracefulShutdownService] Disconnecting Kafka client...
[GracefulShutdownService] ❌ Graceful shutdown failed: Shutdown timeout after 30000ms
[NestApplication] Application terminated
```

## 테스트

### 단위 테스트

```typescript
import { Test } from '@nestjs/testing';
import { GracefulShutdownService } from '@app/events';

describe('GracefulShutdownService', () => {
  let service: GracefulShutdownService;
  let mockKafkaClient: any;

  beforeEach(async () => {
    mockKafkaClient = {
      close: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        {
          provide: 'KAFKA_CLIENT',
          useValue: mockKafkaClient,
        },
        GracefulShutdownService,
      ],
    }).compile();

    service = module.get(GracefulShutdownService);
  });

  it('should disconnect Kafka client on shutdown', async () => {
    await service.onApplicationShutdown('SIGTERM');

    expect(mockKafkaClient.close).toHaveBeenCalled();
  });

  it('should handle shutdown timeout', async () => {
    mockKafkaClient.close.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 40000)),
    );

    await expect(
      service.onApplicationShutdown('SIGTERM'),
    ).rejects.toThrow('Shutdown timeout');
  });
});
```

### E2E 테스트

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

describe('Graceful Shutdown (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('should shutdown gracefully', async () => {
    // 애플리케이션 종료
    await app.close();

    // Kafka 연결이 정상적으로 종료되었는지 확인
    // (로그 확인 또는 모니터링 시스템 체크)
  });
});
```

## 고급 사용법

### 수동으로 Graceful Shutdown 트리거

```typescript
import { Injectable } from '@nestjs/common';
import { GracefulShutdownService } from '@app/events';

@Injectable()
export class HealthService {
  constructor(
    private readonly shutdownService: GracefulShutdownService,
  ) {}

  async triggerShutdown() {
    // 수동으로 graceful shutdown 실행
    await this.shutdownService.triggerShutdown();
    
    // 프로세스 종료
    process.exit(0);
  }
}
```

### 커스텀 Shutdown 로직 추가

GracefulShutdownService를 확장하여 커스텀 로직을 추가할 수 있습니다:

```typescript
import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { GracefulShutdownService } from '@app/events';

@Injectable()
export class CustomShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(CustomShutdownService.name);

  constructor(
    private readonly eventsShutdown: GracefulShutdownService,
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Custom shutdown initiated (signal: ${signal})`);

    try {
      // 1. Kafka graceful shutdown
      await this.eventsShutdown.onApplicationShutdown(signal);

      // 2. 데이터베이스 연결 종료
      await this.databaseService.disconnect();

      // 3. 캐시 연결 종료
      await this.cacheService.disconnect();

      this.logger.log('✅ Custom shutdown completed');
    } catch (error) {
      this.logger.error('❌ Custom shutdown failed', error);
    }
  }
}
```

## 프로덕션 환경 설정

### Docker 컨테이너

Dockerfile에서 SIGTERM 신호를 올바르게 전달해야 합니다:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

# Graceful shutdown을 위해 SIGTERM 전달
STOPSIGNAL SIGTERM

CMD ["node", "dist/main.js"]
```

### Kubernetes

Kubernetes에서 graceful shutdown을 위한 설정:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
        - name: order-service
          image: order-service:latest
          
          # Graceful shutdown 설정
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]
          
          # Termination grace period (기본값: 30초)
          terminationGracePeriodSeconds: 30
```

### PM2

PM2 사용 시 graceful shutdown 설정:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'order-service',
    script: 'dist/main.js',
    
    // Graceful shutdown 설정
    kill_timeout: 30000,  // 30초 (기본값)
    wait_ready: true,
    listen_timeout: 10000,
    
    // 신호 전달
    shutdown_with_message: false,
  }],
};
```

## 모니터링

### 로그 기반 모니터링

```bash
# Graceful shutdown 로그 확인
tail -f logs/app.log | grep "Graceful shutdown"

# 성공적인 shutdown
[GracefulShutdownService] ✅ Graceful shutdown completed

# 실패한 shutdown
[GracefulShutdownService] ❌ Graceful shutdown failed
```

### Prometheus 메트릭 (추후 추가 예정)

```typescript
// 예정된 메트릭
- kafka_shutdown_duration_seconds
- kafka_shutdown_success_total
- kafka_shutdown_failure_total
- kafka_shutdown_timeout_total
```

## Best Practices

1. **타임아웃 설정**: 기본 30초는 대부분의 경우 충분함
2. **로드밸런서 설정**: 새 연결을 받지 않도록 설정
3. **Health Check**: Shutdown 시작 시 health check 실패 반환
4. **로깅**: Shutdown 과정을 상세히 로깅
5. **모니터링**: Shutdown 실패 알림 설정

## 트러블슈팅

### Q: Shutdown이 30초 후 타임아웃됩니다

A: 
- In-flight 메시지가 너무 많거나 처리가 느린 경우
- Consumer의 `max.poll.interval.ms` 설정 확인
- 메시지 처리 시간 최적화

### Q: Kafka 연결이 종료되지 않습니다

A:
- ClientKafka의 close() 메서드가 정상 호출되는지 확인
- 네트워크 연결 상태 확인
- Kafka 브로커 로그 확인

### Q: 프로세스가 즉시 종료됩니다

A:
- SIGKILL 대신 SIGTERM 신호 사용
- `enableShutdownHooks` 활성화 확인:
  ```typescript
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();  // ✅ 필수!
  await app.listen(3000);
  ```

### Q: Docker 컨테이너가 강제 종료됩니다

A:
- Dockerfile에 `STOPSIGNAL SIGTERM` 추가
- `terminationGracePeriodSeconds` 충분히 설정 (Kubernetes)
- Docker stop 시 타임아웃 설정: `docker stop -t 30 container-name`

## 참고 자료

- [NestJS Lifecycle Events](https://docs.nestjs.com/fundamentals/lifecycle-events)
- [KafkaJS Disconnection](https://kafka.js.org/docs/consuming#disconnect)
- [자동 DLQ 처리 가이드](./auto-dlq-guide.md)
- [메인 README](../README.md)

## 다음 단계

- Consumer 측 Idempotency (messageId 중복 체크)
- 배치 발행 최적화 (sendBatch)
- Prometheus 메트릭 추가

