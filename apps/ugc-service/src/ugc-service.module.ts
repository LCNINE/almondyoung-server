import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { AuthorizationModule, authorizationSchema, JwtAuthGuard } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { UgcServiceController } from './ugc-service.controller';
import { UgcServiceService } from './ugc-service.service';
import { ReviewsModule } from './reviews/reviews.module';
import { ugcServiceSchema } from './db/schema';

const combinedSchema = { ...ugcServiceSchema, ...authorizationSchema };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/ugc-service/.env'],
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'ugc-service',
      scopes: [],
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    ReviewsModule,
  ],
  controllers: [UgcServiceController],
  providers: [
    UgcServiceService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class UgcServiceModule {}
