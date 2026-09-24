import { CreateLogoContestEntryDto } from '../dto/logo-contest.dto';
import { AlreadySubmittedError } from '../errors/already-submitted.error';
import { LogoContestPeriodService } from '../services/logo-contest-period.service';
import { LogoContestService } from '../services/logo-contest.service';
import { LogoContestController } from './logo-contest.controller';

it('중복 출품 도메인 오류를 HTTP 409로 변환한다', async () => {
  const service = { create: jest.fn().mockRejectedValue(new AlreadySubmittedError()) } as unknown as LogoContestService;
  const controller = new LogoContestController(service, {} as LogoContestPeriodService);
  const dto: CreateLogoContestEntryDto = {
    title: '로고',
    mediaFileIds: ['22222222-2222-4222-8222-222222222222'],
    authorName: '작성자',
    agreed: true,
  };

  await expect(controller.create('11111111-1111-4111-8111-111111111111', dto)).rejects.toMatchObject({
    status: 409,
    response: { code: 'CONFLICT', message: new AlreadySubmittedError().message },
  });
});
