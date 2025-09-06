// apps/wms/src/main.ts
import { NestFactory } from '@nestjs/core';
import { WmsModule } from './wms.module';

async function bootstrap() {
  const app = await NestFactory.create(WmsModule);
  await app.listen(process.env.PORT ?? 3010);
}
bootstrap();
