# DB 모듈

MSA 기반 멀티레포 NestJS 프로젝트에서 사용하는 공통 DB 모듈입니다. Drizzle ORM을 기반으로 하며, 각 마이크로서비스가 자신의 스키마를 전달하여 완전한 타입 안정성을 보장받을 수 있습니다.

## 특징

- ✅ Drizzle ORM 기반
- ✅ 완전한 TypeScript 타입 안정성
- ✅ 각 마이크로서비스별 독립적인 스키마 지원
- ✅ 동적 모듈 구성
- ✅ 환경 변수 기반 설정 지원

## 설치

```bash
npm install drizzle-orm postgres
npm install -D @types/pg
```

## 사용법

### 1. 스키마 정의 (각 마이크로서비스에서)

```typescript
// apps/user-service/src/schema.ts
import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userSchema = { users };
export type UserSchema = typeof userSchema;
```

### 2. 모듈 설정

```typescript
// apps/user-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { DbModule, createDbConfigFromEnv } from '@app/db';
import { userSchema, UserSchema } from './schema';

@Module({
  imports: [
    // DbModule은 전역 모듈로 설정되어 있어 한 번만 import하면 됩니다
    DbModule.forRoot<UserSchema>({
      config: createDbConfigFromEnv({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: process.env.DB_PORT!,
        DB_NAME: process.env.DB_NAME!,
        DB_USER: process.env.DB_USER!,
        DB_PASSWORD: process.env.DB_PASSWORD!,
      }),
      schema: userSchema,
    }),
  ],
})
export class AppModule {}
```

### 3. 서비스에서 사용

```typescript
// apps/user-service/src/user.service.ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { UserSchema, users } from './schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class UserService {
  constructor(
    // 전역 모듈이므로 별도의 import 없이 DbService를 주입받을 수 있습니다
    private readonly dbService: DbService<UserSchema>,
  ) {}

  async createUser(name: string, email: string) {
    return this.dbService.db
      .insert(users)
      .values({ name, email })
      .returning();
  }

  async findUserById(id: number) {
    return this.dbService.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
  }

  async findAllUsers() {
    return this.dbService.db.select().from(users);
  }

  async updateUser(id: number, data: Partial<{ name: string; email: string }>) {
    return this.dbService.db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
  }

  async deleteUser(id: number) {
    return this.dbService.db
      .delete(users)
      .where(eq(users.id, id))
      .returning();
  }

  // 트랜잭션 사용 예시
  async createUsersInTransaction(userData: Array<{ name: string; email: string }>) {
    return this.dbService.transaction(async (tx) => {
      const results = [];
      for (const data of userData) {
        const [user] = await tx.insert(users).values(data).returning();
        results.push(user);
      }
      return results;
    });
  }
}
```

### 4. 다른 마이크로서비스 예시

```typescript
// apps/order-service/src/schema.ts
import { pgTable, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const orderSchema = { orders };
export type OrderSchema = typeof orderSchema;

// apps/order-service/src/order.service.ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { OrderSchema, orders } from './schema';

@Injectable()
export class OrderService {
  constructor(
    // 전역 모듈이므로 별도의 import 없이 DbService를 주입받을 수 있습니다
    private readonly dbService: DbService<OrderSchema>,
  ) {}

  async createOrder(userId: number, productName: string, quantity: number) {
    return this.dbService.db
      .insert(orders)
      .values({ userId, productName, quantity })
      .returning();
  }

  // 완전한 타입 안정성을 가진 쿼리
  async findOrdersByUserId(userId: number) {
    return this.dbService.db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId));
  }
}
```

## 환경 변수 설정

각 마이크로서비스의 `.env` 파일:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=user_service_db
DB_USER=postgres
DB_PASSWORD=password
```

## 타입 안정성

이 DB 모듈은 완전한 타입 안정성을 제공합니다:

- ✅ 스키마에 정의된 테이블만 접근 가능
- ✅ 컬럼명과 타입이 컴파일 타임에 체크됨
- ✅ 쿼리 결과의 타입이 자동으로 추론됨
- ✅ 잘못된 쿼리는 TypeScript 에러로 미리 방지

## 마이그레이션

각 마이크로서비스에서 독립적으로 마이그레이션을 관리할 수 있습니다:

```typescript
// drizzle.config.ts (각 마이크로서비스마다)
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
  },
} satisfies Config;
``` 