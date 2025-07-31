import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NotificationModule } from './notification.module';
import { AllExceptionsFilter } from './shared/filters/exception.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';

async function bootstrap() {
    const app = await NestFactory.create(NotificationModule);

    // Global pipes
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));

    // Global filters
    app.useGlobalFilters(new AllExceptionsFilter());

    // Global interceptors
    app.useGlobalInterceptors(new LoggingInterceptor());

    // CORS
    app.enableCors({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
        credentials: true,
    });

    const port = process.env.NOTIFICATION_PORT ?? 5001;
    await app.listen(port);

    console.log(`Notification service is running on port ${port}`);
}
bootstrap();