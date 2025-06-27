import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { userSchema } from '../database/drizzle/schema';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbModule.forRoot({
      config: {
        connectionString:
          'postgres://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service',
      },
      schema: userSchema,
    }),
    AuthModule.forRootAsync(),
    UserModule,
  ],
})
export class AppModule {}
