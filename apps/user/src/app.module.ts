import { Module } from '@nestjs/common';
import { DbModule, createDbConfigFromEnv } from '@app/db';
import { userSchema, UserSchema } from '../database/drizzle/schema';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbModule.forRoot({
      config: {
        host: 'ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech',
        port: 5432,
        database: 'almond-users-service',
        username: 'almond-users-service_owner',
        password: 'npg_PESMZpX6nu5L',
      },
      schema: userSchema,
    }),
  ],
})
export class AppModule {}
