// ⚠️ 환경변수를 가장 먼저 로드 (다른 import보다 먼저!)
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({
  path: path.resolve(process.cwd(), 'apps/outbox-demo/.env.local'),
  override: false, // 이미 있는 환경변수는 덮어쓰지 않음
});

dotenv.config({
  path: path.resolve(process.cwd(), 'apps/outbox-demo/.env'),
  override: false, // .env.local이 우선
});

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3003;
  await app.listen(port);

  console.log(`🚀 Outbox Demo app is running on: http://localhost:${port}`);
}

bootstrap();
