import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { EventsModule } from '@app/events';
import { PAYMENTS_COMMANDS_V1_STREAM } from '@packages/event-contracts';
import { GlobalExceptionFilter } from '@app/shared';
import { WalletModule } from './wallet.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    WalletModule,
    new FastifyAdapter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      disableErrorMessages: false,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  if ((process.env.KAFKA_BROKERS ?? '').trim()) {
    const consumerOptions = EventsModule.forConsumer({
      streams: [PAYMENTS_COMMANDS_V1_STREAM],
      groupId:
        process.env.WALLET_COMMAND_CONSUMER_GROUP_ID ?? 'wallet-command-consumer',
    });
    app.connectMicroservice(consumerOptions);
    await app.startAllMicroservices();
  }

  const config = new DocumentBuilder()
    .setTitle('Wallet API')
    .setDescription('Wallet rebuild service API')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
    if (request.url === '/docs.yaml') {
      reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
    }
    done();
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
