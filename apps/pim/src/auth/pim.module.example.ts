// ===== PIM Module Integration Example =====
// This file shows how to integrate the Authorization module into PIM service.
// Copy this configuration to your actual pim.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { AuthorizationModule, JwtAuthGuard, ScopeGuard, authorizationSchema } from '@app/authorization';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { validatePimEnv } from '../config/env.validation';
import { pimSchema } from '../schema';
import { PIM_SCOPES } from './pim.scopes';

// Combine PIM schema with authorization schema
const combinedSchema = {
  ...pimSchema,
  ...authorizationSchema,
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validatePimEnv,
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL || '',
      },
      schema: combinedSchema, // Use combined schema
    }),
    // Add auth modules

    AuthorizationModule.forRoot({
      microserviceName: 'pim',
      scopes: PIM_SCOPES,
    }),
    EventsModule.forRoot({
      streams: [PRODUCT_STREAM],
      serviceName: 'pim',
      enableDLQ: true,
    }),
    // ... other modules
  ],
  providers: [
    // Add global guards
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // Step 1: Authentication
    },
    {
      provide: APP_GUARD,
      useClass: ScopeGuard, // Step 2: Authorization
    },
    // ... other providers
  ],
})
export class PimModule {}
