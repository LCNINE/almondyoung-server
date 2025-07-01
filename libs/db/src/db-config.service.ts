import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Database configuration interface
 */
export interface DbConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
}

/**
 * Database configuration service using NestJS ConfigService
 */
@Injectable()
export class DbConfigService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Get database configuration with validation
   */
  getDatabaseConfig(): DbConfig {
    const host = this.configService.get<string>('DB_HOST');
    const port = this.configService.get<number>('DB_PORT', 5432);
    const database = this.configService.get<string>('DB_NAME');
    const username = this.configService.get<string>('DB_USER');
    const password = this.configService.get<string>('DB_PASSWORD');
    const ssl = this.configService.get<boolean>('DB_SSL', false);

    // Validation
    if (!host || !database || !username || !password) {
      throw new Error(
        'Missing required database configuration. Please check DB_HOST, DB_NAME, DB_USER, DB_PASSWORD environment variables.',
      );
    }

    return {
      host,
      port,
      database,
      username,
      password,
      ssl,
    };
  }

  /**
   * Get database connection string
   */
  getDatabaseUrl(): string {
    const config = this.getDatabaseConfig();
    const sslParam = config.ssl ? '?sslmode=require' : '';

    return `postgresql://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}${sslParam}`;
  }
}
