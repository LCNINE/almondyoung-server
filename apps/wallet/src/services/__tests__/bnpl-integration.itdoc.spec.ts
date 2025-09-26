import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common'; // Express 기반은 NestFastifyApplication 대신 INestApplication
import { describeAPI, itDoc, field, HttpMethod, HttpStatus } from 'itdoc';
import { getTsid } from 'tsid-ts';
import { AppModule } from '../../app.module';
import { DbModule, DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import { BnplAccountService } from '../bnpl-account.service';

declare global {
  var __APP__: any;
}

let moduleRef: TestingModule;
let app: INestApplication;
let dbService: DbService<typeof schema>;
let profileService: PaymentProfileService;
let bnplAccountService: BnplAccountService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      DbModule.forRoot({
        config: {
          connectionString: process.env.DATABASE_URL || 'postgresql://…',
        },
        schema,
      }),
      AppModule,
    ],
  }).compile();

  // 👇 FastifyAdapter 안 넘기면 ExpressAdapter가 기본
  app = moduleRef.createNestApplication();
  await app.init();

  global.__APP__ = app.getHttpServer();
  dbService = moduleRef.get(DbService);
  profileService = moduleRef.get(PaymentProfileService);
  bnplAccountService = moduleRef.get(BnplAccountService);
});

afterAll(async () => {
  await cleanupTestData();
  if (app) await app.close();
  if (moduleRef) await moduleRef.close();
});

async function cleanupTestData() {
  try {
    await dbService.db.delete(schema.paymentAttempts);
    await dbService.db.delete(schema.paymentIntents);
    await dbService.db.delete(schema.bnplAccounts);
    await dbService.db.delete(schema.paymentProfiles);
  } catch (err) {
    console.warn('테스트 데이터 정리 중 오류:', err);
  }
}

// 이제부터 describeAPI/itDoc 그대로 사용
describeAPI(
  HttpMethod.POST,
  '/api/v1/payment-profiles/bnpl',
  {
    summary: 'BNPL 결제 프로필 생성',
    tag: 'BNPL',
    description:
      'BNPL(나중결제) 결제 프로필을 생성하고 출금 동의서를 등록합니다.',
  },
  global.__APP__,
  (apiDoc) => {
    const testUserId = getTsid().toString();
    const testMemberId = 'test-member-' + Date.now();

    itDoc('BNPL 프로필 생성 성공', async () => {
      return await apiDoc
        .test()
        .req()
        .header({
          'Content-Type': field<string>('Content-Type', 'application/json'),
          'X-User-Id': field<string>('사용자 ID', String(testUserId)),
        })
        .body({
          providerType: field('결제 수단 타입', 'HMS_BNPL'),
          memberId: field('회원 ID', testMemberId),
          agreementId: field('출금 동의서 ID', 'agreement-' + Date.now()),
          creditLimit: field('신용 한도', 500000),
          billingCycleDay: field('결제일', 30),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          success: field('성공 여부', true),
          profileId: field('생성된 프로필 ID', (v) => typeof v === 'string'),
          bnplAccountId: field(
            '생성된 BNPL 계정 ID',
            (v) => typeof v === 'string',
          ),
        });
    });
  },
);
