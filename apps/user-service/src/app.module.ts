import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { userSchema } from '../database/drizzle/schema';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
  ],
})
export class AppModule {}
