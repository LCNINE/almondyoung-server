import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { userSchema } from '../database/drizzle/schema';
import { AuthModule } from './api/auth/auth.module';
import { EmailModule } from './api/email/email.module';
import { RolesModule } from './api/roles/roles.module';
import { ScopesModule } from './api/scopes/scopes.module';
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
    AuthModule,
    UsersModule,
    RolesModule,
    ScopesModule,
    EmailModule,
    ShopModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
