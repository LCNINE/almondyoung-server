import { Module, DynamicModule } from '@nestjs/common';
import { DbService, DbConfig, DB_CONNECTION, DB_SCHEMA } from './db.service';

export interface DbModuleOptions<TSchema extends Record<string, unknown>> {
  config: DbConfig;
  schema: TSchema;
}

@Module({})
export class DbModule {
  static forRoot<TSchema extends Record<string, unknown>>(
    options: DbModuleOptions<TSchema>,
  ): DynamicModule {
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
      global: false, // 각 마이크로서비스에서 명시적으로 import하도록
    };
  }
}
