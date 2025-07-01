import { NestFactory } from '@nestjs/core';
import { PaymsModule } from './payms.module';

async function bootstrap() {
  const app = await NestFactory.create(PaymsModule);
  await app.listen(process.env.port ?? 5000);
}
bootstrap();
