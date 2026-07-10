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
  // NOTE(itdoc auth): 이 스펙은 x-user-id 헤더로 사용자를 지정하지만, AppModule 의 전역 JwtAuthGuard
  // (APP_GUARD, passport 'jwt')는 이를 인증으로 인정하지 않아 모든 요청이 401 이다. Nest 표준
  // overrideProvider(APP_GUARD)/overrideGuard 로는 이 전역 가드가 교체되지 않음을 로컬에서 확인했다.
  // 실제 통과시키려면 itdoc 스펙이 AUTH_SECRET 으로 서명한 실 JWT(Bearer)를 보내거나, 별도 test 전용
  // 인증 우회를 배선해야 한다(별도 harness 과제). 여기서는 앱 부팅(@packages 해석)만 정상화한다.
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
