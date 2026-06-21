import { DbModule } from '@app/db';
import { EventsModule, EventTraceApiModule } from '@app/events';
import { AuthorizationModule, authorizationSchema, ScopeGuard } from '@app/authorization';
import { ResponseInterceptor } from '@app/shared';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import { userServiceSchema as baseUserServiceSchema } from '../database/drizzle/schema';
import { AdminModule } from './api/admin/admin.module';
import { AuthModule } from './api/auth/auth.module';
import { OAuthModule } from './api/oauth/oauth.module';
import { WellKnownModule } from './api/well-known/well-known.module';
import { BusinessLicensesModule } from './api/business-licenses/business-licenses.module';
import { Cafe24Module } from './api/cafe24/cafe24.module';
import { Cafe24LinkModule } from './api/cafe24-link/cafe24-link.module';
import { ConsentsModule } from './api/consents/consents.module';
import { FileModule } from './api/file/file.module';
import { RecentViewsModule } from './api/recent-views/recent-views.module';
import { ShopModule } from './api/shop/shop.module';
import { TwilioModule } from './api/twilio/twilio.module';
import { createKafkaConfigFromEnv } from '@app/events';
import { UsersModule } from './api/users/users.module';
import { WishlistModule } from './api/wishlist/wishlist.module';
import { JwtAuthGuard } from './commons/guards/jwt-auth.guard';
import { validateUserServiceEnv } from './config/env.validation';
import { HealthController } from './health.controller';
import { ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';

const userServiceSchema = { ...baseUserServiceSchema, ...authorizationSchema };

// ─── Optional modules (enabled only when env vars are present) ───
const optionalModules: any[] = [];

if (process.env.CAFE24_CLIENT_ID) {
  optionalModules.push(Cafe24Module);
} else {
  console.warn('⚠️  CAFE24_CLIENT_ID가 설정되지 않아 Cafe24 토큰 관리가 비활성화됩니다.');
}

if (process.env.CAFE24_SERVICE_KEY) {
  optionalModules.push(Cafe24LinkModule);
} else {
  console.warn('⚠️  CAFE24_SERVICE_KEY가 설정되지 않아 Cafe24 계정 연동이 비활성화됩니다.');
}

if (process.env.TWILIO_ACCOUNT_SID) {
  optionalModules.push(TwilioModule);
} else {
  console.warn('⚠️  TWILIO_ACCOUNT_SID가 설정되지 않아 SMS 인증이 비활성화됩니다.');
}

config({
  path: join(process.cwd(), 'apps', 'user-service', '.env'),
});

const staticRoot = existsSync(join(__dirname, 'static')) ? join(__dirname, 'static') : join(__dirname, '..', 'static');

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
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
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres',
      },
      schema: userServiceSchema,
    }),
    EventsModule.forRoot({
      streams: [USER_STREAM],
      serviceName: 'user-service',
      kafka: createKafkaConfigFromEnv()!,
      validation: {
        validateOnPublish: true,
        throwOnValidationError: true,
      },
    }),
    EventTraceApiModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 10,
        },
      ],
    }),
    ServeStaticModule.forRoot({
      rootPath: staticRoot,
      serveRoot: '/static',
      serveStaticOptions: {
        setHeaders: (res) => {
          const target = res?.raw ?? res;
          if (!target || typeof target.setHeader !== 'function') {
            return;
          }
          target.setHeader('Access-Control-Allow-Origin', '*');
          target.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          if (typeof target.removeHeader === 'function') {
            target.removeHeader('Access-Control-Allow-Credentials');
            target.removeHeader('Access-Control-Expose-Headers');
          }
        },
      },
    }),

    ScheduleModule.forRoot(),
    AuthorizationModule.forRoot({
      microserviceName: 'user-service',
      scopes: [
        { key: 'user:read', category: 'user', description: '사용자 - 본인 정보 조회' },
        { key: 'user:modify', category: 'user', description: '사용자 - 본인 정보 수정' },
        { key: 'user:delete', category: 'user', description: '사용자 - 본인 계정 삭제' },
        { key: 'admin:access', category: 'admin', description: '관리자 - 어드민 접근' },
        { key: 'admin:users:read', category: 'admin', description: '관리자 - 회원 조회' },
        { key: 'admin:users:modify', category: 'admin', description: '관리자 - 회원 수정' },
        { key: 'admin:users:archive', category: 'admin', description: '관리자 - 회원 보관' },
        { key: 'admin:users:purge', category: 'admin', description: '관리자 - 회원 완전삭제' },
      ],
    }),
    AuthModule.register(),
    OAuthModule,
    WellKnownModule,
    UsersModule,
    ...optionalModules,
    ShopModule,
    ConsentsModule,
    WishlistModule,
    RecentViewsModule,
    FileModule,
    BusinessLicensesModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ScopeGuard,
    },
  ],
})
export class AppModule {}
