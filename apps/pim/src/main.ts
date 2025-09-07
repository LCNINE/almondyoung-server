import { NestFactory } from '@nestjs/core';
import { PimModule } from './pim.module';

async function bootstrap() {
  const app = await NestFactory.create(PimModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
