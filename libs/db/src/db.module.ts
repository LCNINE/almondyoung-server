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
      global: true, // 전역 모듈로 설정하여 모든 모듈에서 자동으로 사용 가능
    };
  }
}
