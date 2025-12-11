# Events Outbox 스키마 마이그레이션 가이드

## 개요

`libs/events` 모듈의 Outbox 스키마는 각 마이크로서비스의 로컬 DB에 포함되어야 합니다.
이 문서는 Outbox 패턴을 사용하는 앱에서 어떻게 Drizzle 마이그레이션을 설정하는지 안내합니다.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     libs/events                              │
│  - outbox.schema.ts (공용 스키마 정의)                       │
│  - OutboxPublisher, OutboxDispatcher                         │
└─────────────────────────────────────────────────────────────┘
                            ↓ import
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │ WMS DB   │        │ PIM DB   │        │Wallet DB │
  │ - wms    │        │ - pim    │        │- wallet  │
  │ - event  │        │ - event  │        │- event   │
  └──────────┘        └──────────┘        └──────────┘
```

각 마이크로서비스는:
- 자신의 비즈니스 스키마 (예: `wms`, `pim`, `wallet`)
- **공용 `event` 스키마** (outbox_events 테이블)

를 동일한 DB에 포함합니다.

## 설정 방법

### 1. drizzle.config.ts 수정

Outbox 패턴을 사용하는 앱의 `drizzle.config.ts`에서 `schema`를 배열로 변경하고 outbox 스키마를 포함:

#### 예시: apps/outbox-demo/drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './database/schemas/*.schema.ts',              // 앱 자체 스키마
    '../../libs/events/src/outbox/outbox.schema.ts', // Outbox 스키마 추가
  ],
  out: './database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
});
```

#### 예시: apps/wms/database/drizzle/drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '../../.env'), override: true });

export default defineConfig({
  schema: [
    'apps/wms/database/schemas/wms-schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',  // 추가
  ],
  out: 'apps/wms/database/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
});
```

### 2. AppModule에서 스키마 병합

NestJS 모듈에서 DbModule을 설정할 때 outbox 스키마를 포함:

```typescript
import { EventsModule } from '@app/events';
import { wmsSchema } from './database/schemas/wms-schema';

const combinedSchema = {
  ...wmsSchema,
  ...EventsModule.outboxSchema,  // Outbox 스키마 병합
};

@Module({
  imports: [
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,  // 병합된 스키마 사용
    }),
    EventsModule.forRoot({
      streams: [ORDER_STREAM],
      serviceName: 'wms',
      enableOutbox: true,  // Outbox 활성화
    }),
  ],
})
export class WmsModule {}
```

### 3. 마이그레이션 실행

```bash
# 스키마 변경 사항을 마이그레이션 파일로 생성
npm run db:generate:wms

# DB에 적용 (개발 환경)
npm run db:push:wms
```

## Outbox 패턴을 사용하는 앱 목록

다음 앱들이 Outbox 패턴을 설정해야 합니다:

### ✅ 설정 완료
- [x] `apps/outbox-demo` - 예시 앱

### 🔄 설정 필요
- [ ] `apps/wms` - WMS 주문 이벤트
- [ ] `apps/channel-adapter` - 채널 어댑터 이벤트
- [ ] `apps/wallet` - 지갑 이벤트
- [ ] 기타 Outbox를 사용할 모든 앱

## 각 앱별 설정 체크리스트

앱에서 Outbox를 활성화할 때:

- [ ] `drizzle.config.ts`에 outbox 스키마 경로 추가
- [ ] `AppModule`에서 `EventsModule.outboxSchema` 병합
- [ ] `EventsModule.forRoot({ enableOutbox: true })` 설정
- [ ] `npm run db:generate:<app>` 실행
- [ ] `npm run db:push:<app>` 실행 (또는 마이그레이션 적용)
- [ ] DB에 `event.outbox_events` 테이블 생성 확인

## FAQ

### Q: 왜 libs/events에 별도 drizzle.config.ts가 없나요?

A: Outbox 스키마는 각 마이크로서비스의 로컬 DB에 포함되어야 하므로, 중앙에서 관리하는 것이 아니라 각 앱의 drizzle.config.ts에서 포함시킵니다.

### Q: 기존에 수동 SQL로 마이그레이션했는데?

A: `libs/events/scripts/migrate-event-schema.ts`는 deprecated 되었습니다. 
새로운 방식(drizzle-kit)을 사용하면:
- 스키마 변경 시 자동으로 마이그레이션 파일 생성
- 타입 안전성 보장
- 일관된 마이그레이션 워크플로우

### Q: 여러 DB에 같은 스키마를 push하려면?

A: 각 앱의 `.env` 파일에 각자의 `DATABASE_URL`이 설정되어 있으므로:

```bash
# WMS DB에 push
npm run db:push:wms

# PIM DB에 push
npm run db:push:pim

# Wallet DB에 push
npm run db:push:wallet
```

각 명령어는 해당 앱의 DATABASE_URL을 사용합니다.

### Q: Outbox 스키마가 변경되면?

A: `libs/events/src/outbox/outbox.schema.ts`를 수정하면, 각 앱에서 `db:generate` 명령을 실행할 때 자동으로 변경사항이 감지됩니다.

```bash
# 예: WMS 앱의 경우
npm run db:generate:wms  # 마이그레이션 파일 생성
npm run db:push:wms      # 변경사항 적용
```

## 참고

- Drizzle ORM 문서: https://orm.drizzle.team/
- Transactional Outbox 패턴: `docs/transactional-outbox-pattern.md`
- Outbox Demo 앱: `apps/outbox-demo/README.md`

