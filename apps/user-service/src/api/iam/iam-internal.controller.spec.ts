import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IamInternalController, type EtagReply } from './iam-internal.controller';
import { IamService } from './iam.service';

describe('IamInternalController', () => {
  const snapshot = { version: 'abc123', roles: { admin: ['a.b.read'] } };
  const service = { roleSnapshot: jest.fn().mockResolvedValue(snapshot) };
  let controller: IamInternalController;

  const reply = () => {
    const calls = { status: [] as number[], headers: [] as [string, string][] };
    const fake: EtagReply = {
      status(code) {
        calls.status.push(code);
        return fake;
      },
      header(name, value) {
        calls.headers.push([name, value]);
        return fake;
      },
    };
    return { fake, calls };
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [IamInternalController],
      providers: [
        { provide: IamService, useValue: service },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    controller = module.get(IamInternalController);
  });

  it('answers 304 with no body when the caller already has this content', async () => {
    const { fake, calls } = reply();
    expect(await controller.rolePermissions('"abc123"', fake)).toBeUndefined();
    expect(calls.status).toEqual([304]);
  });

  it('returns the snapshot with an ETag when the content changed', async () => {
    const { fake, calls } = reply();
    expect(await controller.rolePermissions('"old"', fake)).toEqual(snapshot);
    expect(calls.headers).toContainEqual(['ETag', '"abc123"']);
    expect(calls.status).toEqual([]);
  });

  it('returns the snapshot when the caller sends no ETag', async () => {
    const { fake } = reply();
    expect(await controller.rolePermissions(undefined, fake)).toEqual(snapshot);
  });
});
