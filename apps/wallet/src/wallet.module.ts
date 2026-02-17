import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthorizationModule,
  JwtAuthGuard,
  authorizationSchema,
} from '@app/authorization';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PAYMENT_STREAM } from '@packages/event-contracts';
import { WALLET_SCOPES } from './auth/wallet.scopes';
import { validateWalletEnv } from './config/env.validation';
import { HealthController } from './health.controller';
import { walletSchema } from './schema';
import { StateTransitionService } from './domain/state-transition/state-transition.service';

const combinedSchema = { ...walletSchema, ...authorizationSchema };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWalletEnv,
      envFilePath: ['.env', 'apps/wallet/.env'],
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'wallet',
      scopes: WALLET_SCOPES,
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    EventsModule.forRoot({
      streams: [PAYMENT_STREAM],
      serviceName: process.env.SERVICE_NAME ?? 'wallet',
      enableDLQ: true,
    }),
  ],
  controllers: [HealthController],
  providers: [
    StateTransitionService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class WalletModule {}
