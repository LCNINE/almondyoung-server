import { Module } from '@nestjs/common';
import { DbModule, createDbConfigFromEnv } from '@app/db';
import { userSchema, UserSchema } from '../database/drizzle/schema';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
  ],
})
export class AppModule {}
