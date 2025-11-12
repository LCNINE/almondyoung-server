import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { AuthorizationGuard } from '@app/roles';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { config } from 'dotenv';
import * as os from 'os';
import { join } from 'path';
import { userServiceSchema } from '../database/drizzle/schema';
import { AdminModule } from './api/admin/admin.module';
import { AuthModule } from './api/auth/auth.module';
import { BusinessLicensesModule } from './api/business-licenses/business-licenses.module';
import { ConsentsModule } from './api/consents/consents.module';
import { EventProcessorModule } from './api/events/events.module';
import { FileModule } from './api/file/file.module';
import { RecentViewsModule } from './api/recent-views/recent-views.module';
import { ShopModule } from './api/shop/shop.module';
import { UsersModule } from './api/users/users.module';
import { WishlistModule } from './api/wishlist/wishlist.module';
import { JwtAuthGuard } from './commons/guards/jwt-auth.guard';
import { validateUserServiceEnv } from './config/env.validation';

config({
  path: join(process.cwd(), 'apps', 'user-service', '.env.dev'),
});
// Kafka 설정 생성 함수
function createKafkaConfig() {
  // 필수 환경변수 검증
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;

  if (!prefix) {
    throw new Error('KAFKA_CLIENT_ID_PREFIX 환경변수가 필요합니다.');
  }

  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    throw new Error('KAFKA_BROKERS 환경변수가 필요합니다.');
  }

  const groupId = process.env.KAFKA_GROUP_ID;
  if (!groupId) {
    throw new Error('KAFKA_GROUP_ID 환경변수가 필요합니다.');
  }

  return {
    clientId: `${prefix}_${os.hostname()}`,
    brokers: brokers.split(','),
    groupId,
    retry: {
      retries: 5,
      initialRetryTime: 300,
    },
    ssl: process.env.KAFKA_API_KEY ? true : false,
    sasl:
      process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET
        ? {
            mechanism: 'plain' as const,
            username: process.env.KAFKA_API_KEY,
            password: process.env.KAFKA_API_SECRET,
          }
        : undefined,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateUserServiceEnv,
      envFilePath: join(
        process.cwd(),
        'apps',
        'user-service',
        process.env.NODE_ENV === 'development' ? '.env.dev' : '.env',
      ),
    }),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgres://postgres:postgres@localhost:5432/postgres',
      },
      schema: userServiceSchema,
    }),
    EventsModule.forRoot({
      streams: [USER_STREAM],
      serviceName: 'user-service',
      kafka: createKafkaConfig(),
      validation: {
        validateOnPublish: true,
        throwOnValidationError: true,
      },
    }),
    ScheduleModule.forRoot(),
    AuthModule.register(),
    UsersModule,
    ShopModule,
    ConsentsModule,
    EventProcessorModule,
    WishlistModule,
    RecentViewsModule,
    FileModule,
    BusinessLicensesModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthorizationGuard,
    },
  ],
})
export class AppModule {}
