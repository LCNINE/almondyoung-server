import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import type { UgcServiceSchema } from '../../db/schema';
import { CreateLogoContestEntryDto } from '../dto/logo-contest.dto';
import { AlreadySubmittedError } from '../errors/already-submitted.error';
import { FileOwnerClient } from '../clients/file-owner.client';
import { LogoContestPeriodService } from './logo-contest-period.service';
import { LogoContestService } from './logo-contest.service';

const USER = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const ICON = '33333333-3333-4333-8333-333333333333';

const closedPeriod = () =>
  new LogoContestPeriodService({
    get: (key: string) =>
      key === 'LOGO_CONTEST_STARTS_AT' ? '2020-10-01T00:00:00+09:00' : '2020-10-30T23:59:59+09:00',
  } as unknown as ConfigService);

const openPeriod = () =>
  new LogoContestPeriodService({
    get: (key: string) =>
      key === 'LOGO_CONTEST_STARTS_AT' ? '2020-10-01T00:00:00+09:00' : '2099-10-30T23:59:59+09:00',
  } as unknown as ConfigService);

/** 기간 밖 요청이 DB 에 닿으면 바로 알아채게, 닿는 순간 터지는 대역을 쓴다. */
const explodingDb = () =>
  ({
    run: () => {
      throw new Error('기간 밖인데 DB 에 닿았다');
    },
  }) as unknown as DbService<UgcServiceSchema>;

const neverCalledFileOwner = () =>
  ({
    assertOwnedImages: jest.fn().mockRejectedValue(new Error('기간 밖인데 파일 검사를 했다')),
  }) as unknown as FileOwnerClient;

describe('LogoContestService 기간 밖 쓰기', () => {
  const service = () => new LogoContestService(explodingDb(), closedPeriod(), neverCalledFileOwner());

  it('마감 뒤에는 투표를 거부한다', async () => {
    await expect(service().vote(USER, ENTRY)).rejects.toThrow(BadRequestError);
  });

  it('마감 뒤에는 투표 취소도 거부한다', async () => {
    await expect(service().unvote(USER, ENTRY)).rejects.toThrow(BadRequestError);
  });

  it('마감 뒤에는 출품 취소를 거부한다 — 표가 지워져 결과가 바뀐다', async () => {
    await expect(service().remove(USER, ENTRY)).rejects.toThrow(BadRequestError);
  });

  it('마감 뒤에는 출품을 거부한다', async () => {
    const dto: CreateLogoContestEntryDto = {
      title: '로고',
      mediaFileIds: [ENTRY, ICON],
      authorName: '정정식',
      agreed: true,
    };

    await expect(service().create(USER, dto)).rejects.toThrow(BadRequestError);
  });

  it('마감 전에는 대상을 지정할 수 없다', async () => {
    const contest = new LogoContestService(explodingDb(), openPeriod(), neverCalledFileOwner());
    await expect(contest.designateWinner(ENTRY)).rejects.toThrow(BadRequestError);
  });
});

it('동시 출품으로 unique 제약이 충돌해도 도메인 오류를 던진다', async () => {
  const db = {
    run: jest.fn().mockRejectedValue({ cause: { code: '23505', constraint_name: 'logo_contest_entries_user_unique' } }),
  } as unknown as DbService<UgcServiceSchema>;
  const fileOwner = { assertOwnedImages: jest.fn().mockResolvedValue(undefined) } as unknown as FileOwnerClient;
  const service = new LogoContestService(db, openPeriod(), fileOwner);

  await expect(
    service.create(USER, { title: '로고', mediaFileIds: [ENTRY, ICON], authorName: '작성자', agreed: true }),
  ).rejects.toThrow(AlreadySubmittedError);
});

it('가로 로고와 파비콘용 심볼 두 장이 아니면 출품을 거부한다', async () => {
  const fileOwner = { assertOwnedImages: jest.fn() } as unknown as FileOwnerClient;
  const service = new LogoContestService(explodingDb(), openPeriod(), fileOwner);

  await expect(
    service.create(USER, { title: '로고', mediaFileIds: [ENTRY], authorName: '작성자', agreed: true }),
  ).rejects.toThrow(BadRequestError);
  await expect(
    service.create(USER, { title: '로고', mediaFileIds: [ENTRY, ICON, USER], authorName: '작성자', agreed: true }),
  ).rejects.toThrow(BadRequestError);
  expect(fileOwner.assertOwnedImages).not.toHaveBeenCalled();
});

it('투표를 취소하면 남은 득표수를 반환한다', async () => {
  const deleted = jest.fn().mockResolvedValue(undefined);
  const tx = {
    delete: () => ({ where: deleted }),
    select: () => ({ from: () => ({ where: async () => [{ value: 2 }] }) }),
  };
  const db = {
    run: (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as DbService<UgcServiceSchema>;
  const service = new LogoContestService(db, openPeriod(), neverCalledFileOwner());

  await expect(service.unvote(USER, ENTRY)).resolves.toEqual({ voteCount: 2 });
  expect(deleted).toHaveBeenCalledTimes(1);
});
