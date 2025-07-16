import { NestFactory } from '@nestjs/core';
import { PaymsModule } from './payms.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(PaymsModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(process.env.port ?? 5000);
}
bootstrap();
