# Events 모듈

MSA 기반 멀티레포 NestJS 프로젝트에서 사용하는 공통 이벤트 모듈입니다. Kafka를 기반으로 하며, 각 마이크로서비스 간의 타입 안전한 이벤트 기반 통신을 지원합니다.

## 특징

- ✅ Kafka 기반 이벤트 시스템
- ✅ 완전한 TypeScript 타입 안정성
- ✅ 이벤트별 페이로드 타입 검증
- ✅ Publisher/Subscriber 패턴 지원
- ✅ Request-Response 패턴 지원
- ✅ 데코레이터 기반 편의 기능
- ✅ 자동 메타데이터 추가 (timestamp, correlationId, source)

## 설치

```bash
npm install @nestjs/microservices kafkajs uuid
npm install -D @types/uuid
```

## 사용법

### 1. 이벤트 타입 정의 (공통 스키마)

```typescript
// libs/shared/src/events/user.events.ts
import { BaseEventPayload, EventDefinition } from '@app/events';

// User 관련 이벤트 페이로드 타입들
export interface UserCreatedPayload extends BaseEventPayload {
  userId: string;
  email: string;
  name: string;
}

export interface UserUpdatedPayload extends BaseEventPayload {
  userId: string;
  email?: string;
  name?: string;
}

export interface UserDeletedPayload extends BaseEventPayload {
  userId: string;
}

// 이벤트 정의
export const USER_EVENTS = {
  USER_CREATED: {
    topic: 'user.created',
    payload: {} as UserCreatedPayload,
  },
  USER_UPDATED: {
    topic: 'user.updated',
    payload: {} as UserUpdatedPayload,
  },
  USER_DELETED: {
    topic: 'user.deleted',
    payload: {} as UserDeletedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type UserEvents = typeof USER_EVENTS;
```

### 2. 이벤트 발행자 설정 (User Service)

```typescript
// apps/user-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { USER_EVENTS, UserEvents } from '@app/shared/events/user.events';

@Module({
  imports: [
    EventsModule.forRoot<UserEvents>({
      kafka: createKafkaConfigFromEnv({
        KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID!,
        KAFKA_BROKERS: process.env.KAFKA_BROKERS!,
        KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID,
      }),
      events: USER_EVENTS,
      serviceName: 'user-service',
    }),
  ],
})
export class AppModule {}
```

### 3. 이벤트 발행

```typescript
// apps/user-service/src/user.service.ts
import { Injectable } from '@nestjs/common';
import { EventPublisherService, InjectEventPublisher } from '@app/events';
import { UserEvents } from '@app/shared/events/user.events';

@Injectable()
export class UserService {
  constructor(
    @InjectEventPublisher()
    private readonly eventPublisher: EventPublisherService<UserEvents>,
  ) {}

  async createUser(userData: { email: string; name: string }) {
    // 사용자 생성 로직
    const user = await this.saveUser(userData);

    // 타입 안전한 이벤트 발행
    await this.eventPublisher.publishEvent('USER_CREATED', {
      userId: user.id,
      email: user.email,
      name: user.name,
      // timestamp, correlationId, source는 자동으로 추가됨
    });

    return user;
  }

  async updateUser(
    userId: string,
    updateData: { email?: string; name?: string },
  ) {
    const user = await this.updateUserData(userId, updateData);

    await this.eventPublisher.publishEvent('USER_UPDATED', {
      userId,
      ...updateData,
    });

    return user;
  }

  // 다중 이벤트 발행
  async bulkCreateUsers(usersData: Array<{ email: string; name: string }>) {
    const users = await this.saveUsers(usersData);

    const events = users.map((user) => ({
      eventKey: 'USER_CREATED' as const,
      payload: {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
    }));

    await this.eventPublisher.publishEvents(events);

    return users;
  }
}
```

### 4. 이벤트 구독자 설정 (Notification Service)

```typescript
// apps/notification-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { USER_EVENTS, UserEvents } from '@app/shared/events/user.events';

@Module({
  imports: [
    EventsModule.forRoot<UserEvents>({
      kafka: createKafkaConfigFromEnv({
        KAFKA_CLIENT_ID: 'notification-service',
        KAFKA_BROKERS: process.env.KAFKA_BROKERS!,
        KAFKA_GROUP_ID: 'notification-consumer',
      }),
      events: USER_EVENTS,
      serviceName: 'notification-service',
    }),
  ],
})
export class AppModule {}
```

### 5. 이벤트 핸들러 구현

```typescript
// apps/notification-service/src/user-event.handler.ts
import { Controller, Logger } from '@nestjs/common';
import {
  TypedEventPattern,
  EventHandler,
  TypedMessagePattern,
  MessageHandler,
} from '@app/events';
import {
  UserEvents,
  UserCreatedPayload,
  UserUpdatedPayload,
} from '@app/shared/events/user.events';

@Controller()
export class UserEventHandler {
  private readonly logger = new Logger(UserEventHandler.name);

  // 이벤트 핸들러 (Fire and Forget)
  @TypedEventPattern<UserEvents, 'USER_CREATED'>('USER_CREATED')
  async handleUserCreated(payload: UserCreatedPayload): Promise<void> {
    this.logger.log(`User created: ${payload.userId}`, {
      correlationId: payload.correlationId,
      source: payload.source,
    });

    // 환영 이메일 발송 로직
    await this.sendWelcomeEmail(payload.email, payload.name);
  }

  @TypedEventPattern<UserEvents, 'USER_UPDATED'>('USER_UPDATED')
  async handleUserUpdated(payload: UserUpdatedPayload): Promise<void> {
    this.logger.log(`User updated: ${payload.userId}`);

    // 사용자 정보 변경 알림 로직
    if (payload.email) {
      await this.sendEmailChangeNotification(payload.email);
    }
  }

  // Request-Response 패턴 핸들러
  @TypedMessagePattern<UserEvents, 'USER_DELETED'>('USER_DELETED')
  async handleUserDeletedRequest(
    payload: UserDeletedPayload,
  ): Promise<{ success: boolean }> {
    this.logger.log(`Processing user deletion: ${payload.userId}`);

    // 사용자 관련 알림 정리 로직
    await this.cleanupUserNotifications(payload.userId);

    return { success: true };
  }

  private async sendWelcomeEmail(email: string, name: string) {
    // 이메일 발송 구현
  }

  private async sendEmailChangeNotification(email: string) {
    // 이메일 변경 알림 구현
  }

  private async cleanupUserNotifications(userId: string) {
    // 알림 정리 구현
  }
}
```

### 6. Request-Response 패턴 사용

```typescript
// apps/user-service/src/user.service.ts
export class UserService {
  async deleteUser(userId: string) {
    // Request-Response 패턴으로 다른 서비스에 요청
    const result = await this.eventPublisher.sendRequest(
      'USER_DELETED',
      { userId },
      5000, // 5초 타임아웃
    );

    if (result.success) {
      await this.removeUser(userId);
    }

    return result;
  }
}
```

## 환경 변수 설정

각 마이크로서비스의 `.env` 파일:

```env
KAFKA_CLIENT_ID=user-service
KAFKA_BROKERS=localhost:9092,localhost:9093
KAFKA_GROUP_ID=user-consumer
```

## 고급 기능

### 커스텀 헤더와 파티션 설정

```typescript
await this.eventPublisher.publishEvent('USER_CREATED', payload, {
  partition: 0,
  headers: {
    'x-tenant-id': 'tenant-123',
    'x-request-id': 'req-456',
  },
});
```

### 타입 안전한 이벤트 핸들러 시그니처

```typescript
// 타입 헬퍼를 사용한 핸들러 메서드 정의
const handleUserCreated: EventHandler<UserEvents, 'USER_CREATED'> = async (
  payload,
) => {
  // payload는 자동으로 UserCreatedPayload 타입으로 추론됨
  console.log(payload.userId); // 타입 안전함
};

const handleUserDeletedRequest: MessageHandler<
  UserEvents,
  'USER_DELETED',
  { success: boolean }
> = async (payload) => {
  // payload는 UserDeletedPayload 타입
  // 반환값은 { success: boolean } 타입이어야 함
  return { success: true };
};
```

## 마이크로서비스 Consumer 앱 구성

Consumer 전용 마이크로서비스를 만들 때:

```typescript
// apps/notification-consumer/src/main.ts
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'notification-consumer',
          brokers: ['localhost:9092'],
        },
        consumer: {
          groupId: 'notification-consumer-group',
        },
      },
    },
  );

  await app.listen();
}
bootstrap();
```

## 타입 안정성 보장

이 이벤트 모듈은 다음과 같은 타입 안정성을 제공합니다:

- ✅ 정의된 이벤트만 발행/구독 가능
- ✅ 각 이벤트의 페이로드 타입이 컴파일 타임에 검증됨
- ✅ 이벤트 핸들러의 매개변수 타입이 자동 추론됨
- ✅ Request-Response 패턴의 응답 타입 검증
- ✅ 잘못된 이벤트나 페이로드는 TypeScript 에러로 방지

## Docker Compose로 Kafka 실행

```yaml
# docker-compose.yml
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:latest
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000

  kafka:
    image: confluentinc/cp-kafka:latest
    depends_on:
      - zookeeper
    ports:
      - '9092:9092'
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
```

실행:

```bash
docker-compose up -d
```
