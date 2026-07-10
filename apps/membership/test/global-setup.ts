const tsNode = require('ts-node');
const tsConfigPaths = require('tsconfig-paths');

// ts-node 등록
tsNode.register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
  },
});

// tsconfig-paths 등록 - 중요: 프로젝트 루트 기준으로!
const baseUrl = require('path').resolve(__dirname, '../../../');
tsConfigPaths.register({
  baseUrl: baseUrl,
  // root tsconfig.json 의 paths 와 정합되게 유지한다 — AppModule 이 전이 import 하는
  // @packages/*·@app/authorization 이 빠지면 globalSetup 이 모듈 해석 실패로 죽는다.
  paths: {
    '@app/db': ['libs/db/src'],
    '@app/db/*': ['libs/db/src/*'],
    '@app/events': ['libs/events/src'],
    '@app/events/*': ['libs/events/src/*'],
    '@app/shared': ['libs/shared/src'],
    '@app/shared/*': ['libs/shared/src/*'],
    '@app/authorization': ['libs/authorization/src'],
    '@app/authorization/*': ['libs/authorization/src/*'],
    '@packages/event-contracts': ['packages/event-contracts'],
    '@packages/event-contracts/*': ['packages/event-contracts/*'],
    '@packages/domain-types': ['packages/domain-types'],
    '@packages/domain-types/*': ['packages/domain-types/*'],
    '@packages/product-description': ['packages/product-description'],
    '@packages/product-description/*': ['packages/product-description/*'],
  },
});

// 이제 import 가능
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import type { App } from 'supertest/types';

// 4. globalSetup 함수 정의
export default async function globalSetup(): Promise<void> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();

  // supertest가 쓸 수 있는 핸들을 전역으로 저장
  global.__APP__ = app.getHttpServer() as App;
  global.__NEST_APP__ = app;
  global.__MODULE_REF__ = moduleFixture;
}
