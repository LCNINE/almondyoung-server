import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { userSchema } from '../database/drizzle/schema';
import { AuthModule } from './api/auth/auth.module';
import { DormantModule } from './api/dormant/dormant.module';
import { EmailModule } from './api/email/email.module';
import { RolesModule } from './api/roles/roles.module';
import { ScopesModule } from './api/scopes/scopes.module';
import { ShopModule } from './api/shop/shop.module';
import { UsersModule } from './api/users/users.module';
import { JwtAuthGuard } from './commons/guards/jwt-auth.guard';
import { KafkaModule } from './api/kafka/kafka.module';

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
    ScheduleModule.forRoot(),
    KafkaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    ScopesModule,
    EmailModule,
    ShopModule,
    DormantModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
