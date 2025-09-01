import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { createKafkaConfigFromEnv } from '@app/events/types';
import { AuthorizationGuard } from '@app/roles';
import { USER_EVENTS, UserEvents } from '@app/shared/events/user.events';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { userSchema } from '../database/drizzle/schema';
import { AdminBusinessLicensesModule } from './api/admin/business-licenses/business-licenses.module';
import { DormantModule } from './api/admin/dormant/dormant.module';
import { AdminRolesModule } from './api/admin/roles/roles.module';
import { AdminUserModule } from './api/admin/users/user.module';
import { AuthModule } from './api/auth/auth.module';
import { BusinessLicensesModule } from './api/business-licenses/business-licenses.module';
import { EventProcessorModule } from './api/events/events.module';
import { FileModule } from './api/file/file.module';
import { RecentViewsModule } from './api/recent-views/recent-views.module';
import { ShopModule } from './api/shop/shop.module';
import { UsersModule } from './api/users/users.module';
import { WishlistModule } from './api/wishlist/wishlist.module';
import { PublicPrivateGuard } from './commons/guards/auth.guard';
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
    ShopModule,
    DormantModule,
    EventProcessorModule,
    WishlistModule,
    RecentViewsModule,
    FileModule,
    BusinessLicensesModule,
    AdminBusinessLicensesModule,
    AdminRolesModule,
    AdminUserModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: PublicPrivateGuard,
    },
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
