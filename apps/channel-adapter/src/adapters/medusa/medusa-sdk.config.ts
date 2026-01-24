import Medusa from '@medusajs/js-sdk';
import { ConfigService } from '@nestjs/config';

/**
 * Create and configure Medusa SDK instance
 *
 * @param configService - NestJS ConfigService to access environment variables
 * @returns Configured Medusa SDK instance
 *
 * Environment variables required:
 * - MEDUSA_API_URL: Medusa backend URL
 * - MEDUSA_API_KEY: Admin API key (JWT or sk_* format)
 * - NODE_ENV: Environment (development/production)
 */
export function createMedusaSdk(configService: ConfigService): Medusa {
  const apiUrl = configService.get<string>('MEDUSA_API_URL') || '';
  const apiKey = configService.get<string>('MEDUSA_API_KEY');
  const nodeEnv = configService.get<string>('NODE_ENV');

  return new Medusa({
    baseUrl: apiUrl,
    apiKey: apiKey, // SDK auto-handles both JWT and API key (sk_*) authentication
    debug: nodeEnv === 'development',
  });
}
