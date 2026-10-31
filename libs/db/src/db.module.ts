import { Module, DynamicModule, FactoryProvider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DbService, DbConfig, DbRouter, DB_CONNECTION, DB_ROUTER, DB_SCHEMA } from './db.service';

export interface DbModuleOptions<TSchema extends Record<string, unknown>> {
  config: DbConfig;
  schema: TSchema;
}

export interface DbModuleAsyncOptions<TSchema extends Record<string, unknown>> {
  useFactory: (configService: ConfigService) => DbConfig;
  schema: TSchema;
  /** 맥락으로 DB 를 고르는 앱만 준다(`DbRouter`). null 을 돌려주면 라우팅 없이 접속 주소 하나를 쓴다. */
  router?: Pick<FactoryProvider<DbRouter | null>, 'useFactory' | 'inject'>;
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
        ...(options.router ? [{ provide: DB_ROUTER, ...options.router }] : []),
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
