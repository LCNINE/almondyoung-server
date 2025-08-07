import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { createKafkaConfigFromEnv } from '@app/events/types';
import { USER_EVENTS, UserEvents } from '@app/shared/events/user.events';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { userSchema } from '../database/drizzle/schema';
import { AdminModule } from './api/admin/admin.module';
import { AuthModule } from './api/auth/auth.module';
import { DormantModule } from './api/admin/dormant/dormant.module';
import { EmailModule } from './api/email/email.module';
import { ScopesModule } from './api/admin/scopes/scopes.module';
import { ShopModule } from './api/shop/shop.module';
import { UsersModule } from './api/users/users.module';
import { JwtAuthGuard } from './commons/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'development' ? '.env.dev' : '.env',
    }),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgres://postgres:postgres@localhost:5432/postgres',
      },
      schema: userSchema,
    }),
    EventsModule.forRoot<UserEvents>({
      kafka: createKafkaConfigFromEnv({
        KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID!,
        KAFKA_BROKERS: process.env.KAFKA_BROKERS!,
        KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID,
      }),
      events: USER_EVENTS,
      serviceName: 'user-service',
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ScopesModule,
    EmailModule,
    ShopModule,
    DormantModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
