import { ConfigService } from '@nestjs/config';
import { BadRequestError } from '@app/shared';
import { LOGO_CONTEST_IMAGE_CONTEXT_ID } from '../constants/logo-contest.constants';
import { FileOwnerClient } from './file-owner.client';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';

const configOf = () =>
  ({
    get: (key: string) => (key === 'FILE_SERVICE_URL' ? 'http://file-service' : 'internal-key'),
  }) as unknown as ConfigService;

const describeAs = (overrides: Record<string, string | number>) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      id: FILE_ID,
      contextId: LOGO_CONTEST_IMAGE_CONTEXT_ID,
      uploadedBy: OWNER,
      status: 'active',
      mimeType: 'image/png',
      width: 512,
      height: 256,
      ...overrides,
    }),
  }) as unknown as typeof fetch;

  return new FileOwnerClient(configOf());
};

describe('FileOwnerClient.assertOwnedImages', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('본인이 공모전 컨텍스트로 올린 활성 이미지는 통과한다', async () => {
    await expect(describeAs({}).assertOwnedImages([FILE_ID], OWNER)).resolves.toBeUndefined();
  });

  it('가로 로고 다음에 정사각 심볼을 붙이면 통과한다', async () => {
    const client = describeAs({});
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: FILE_ID,
          contextId: LOGO_CONTEST_IMAGE_CONTEXT_ID,
          uploadedBy: OWNER,
          status: 'active',
          mimeType: 'image/png',
          width: url.endsWith(FILE_ID) ? 512 : 256,
          height: 256,
        }),
      }),
    );
    await expect(
      client.assertOwnedImages([FILE_ID, '33333333-3333-4333-8333-333333333333'], OWNER),
    ).resolves.toBeUndefined();
  });

  it('정사각 이미지를 가로 로고 칸에 넣거나 가로 이미지를 심볼 칸에 넣으면 거부한다', async () => {
    await expect(describeAs({ width: 512, height: 512 }).assertOwnedImages([FILE_ID], OWNER)).rejects.toThrow(
      BadRequestError,
    );
    await expect(
      describeAs({}).assertOwnedImages([FILE_ID, '33333333-3333-4333-8333-333333333333'], OWNER),
    ).rejects.toThrow(BadRequestError);
  });

  it('실제 크기가 기록되지 않은 이미지는 거부한다', async () => {
    await expect(describeAs({ width: 0 }).assertOwnedImages([FILE_ID], OWNER)).rejects.toThrow(BadRequestError);
  });

  it('남이 올린 파일은 거부한다', async () => {
    await expect(
      describeAs({ uploadedBy: '33333333-3333-4333-8333-333333333333' }).assertOwnedImages([FILE_ID], OWNER),
    ).rejects.toThrow(BadRequestError);
  });

  it('다른 컨텍스트로 올린 파일은 거부한다', async () => {
    await expect(describeAs({ contextId: 'review-media' }).assertOwnedImages([FILE_ID], OWNER)).rejects.toThrow(
      BadRequestError,
    );
  });

  it('업로드가 끝나지 않은(pending) 파일은 거부한다', async () => {
    await expect(describeAs({ status: 'pending' }).assertOwnedImages([FILE_ID], OWNER)).rejects.toThrow(
      BadRequestError,
    );
  });

  it('svg 는 거부한다', async () => {
    await expect(describeAs({ mimeType: 'image/svg+xml' }).assertOwnedImages([FILE_ID], OWNER)).rejects.toThrow(
      BadRequestError,
    );
  });

  it('file-service 가 실패하면 첨부를 통과시키지 않는다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as unknown as typeof fetch;

    await expect(new FileOwnerClient(configOf()).assertOwnedImages([FILE_ID], OWNER)).rejects.toThrow(BadRequestError);
  });
});
