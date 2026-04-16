import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DbService, DbConfig, DB_CONNECTION, DB_SCHEMA } from './db.service';

export interface DbModuleOptions<TSchema extends Record<string, unknown>> {
  config: DbConfig;
  schema: TSchema;
}

export interface DbModuleAsyncOptions<TSchema extends Record<string, unknown>> {
  useFactory: (configService: ConfigService) => DbConfig;
  schema: TSchema;
}

@Module({})
export class DbModule {
  static forRoot<TSchema extends Record<string, unknown>>(options: DbModuleOptions<TSchema>): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: DB_CONNECTION,
          useValue: options.config,
        },
        {
          provide: DB_SCHEMA,
          useValue: options.schema,
        },
        {
          provide: DbService,
          useClass: DbService,
        },
      ],
      exports: [DbService],
      global: true,
    };
  }

  static forRootAsync<TSchema extends Record<string, unknown>>(options: DbModuleAsyncOptions<TSchema>): DynamicModule {
    return {
      module: DbModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: DB_CONNECTION,
          useFactory: options.useFactory,
          inject: [ConfigService],
        },
        {
          provide: DB_SCHEMA,
          useValue: options.schema,
        },
        {
          provide: DbService,
          useClass: DbService,
        },
      ],
      exports: [DbService],
      global: true,
    };
  }
}
