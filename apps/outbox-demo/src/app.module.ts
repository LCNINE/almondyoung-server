import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { TestModule } from './test/test.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/outbox-demo/.env.local', 'apps/outbox-demo/.env'],
    }),
    DatabaseModule,
    TestModule,
  ],
})
export class AppModule {}
