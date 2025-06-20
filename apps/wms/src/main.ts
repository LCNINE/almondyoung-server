import { NestFactory } from '@nestjs/core';
import { WmsModule } from './wms.module';

async function bootstrap() {
  const app = await NestFactory.create(WmsModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
