import { NestFactory } from '@nestjs/core';
import { PaymsModule } from './payms.module';
import { ZodValidationPipe } from 'nestjs-zod';

async function bootstrap() {
  const app = await NestFactory.create(PaymsModule);
  app.useGlobalPipes(new ZodValidationPipe({ transform: true }));
  await app.listen(process.env.port ?? 5000);
}
bootstrap();
