import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { userSchema } from '../database/drizzle/schema';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import configLoader from './config/config.loader';
import { GlobalConfig } from './config/config.type';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [configLoader],
    }),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgres://postgres:postgres@localhost:5432/postgres',
      },
      schema: userSchema,
    }),
    AuthModule.forRootAsync(),
    UserModule,
  ],
})
export class AppModule {}
