import { UnauthorizedException } from '@nestjs/common';
import { Sku3dModelsController } from './sku-3d-models.controller';

// 실제 AuthenticationService는 id 대신 userId를 정규화해 controller에 전달한다.
describe('Sku3dModelsController authenticated actor', () => {
  const manager = {
    register: jest.fn(),
    review: jest.fn(),
    reviewBatch: jest.fn(),
  };
  const controller = new Sku3dModelsController(manager as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([{ userId: 'authenticated-user' }, { sub: 'authenticated-user' }])(
    'delegates approval using authenticated subject %p',
    (user) => {
      controller.register('sku', { status: 'approved', glbFileId: 'file' }, user as any);
      controller.review('model', { status: 'approved' }, user as any);
      controller.reviewBatch({ ids: ['model'], status: 'approved' }, user as any);

      expect(manager.register).toHaveBeenCalledWith('sku', expect.anything(), 'authenticated-user');
      expect(manager.review).toHaveBeenCalledWith('model', expect.anything(), 'authenticated-user');
      expect(manager.reviewBatch).toHaveBeenCalledWith(['model'], expect.anything(), 'authenticated-user');
    },
  );

  it('rejects missing subjects before file-service delegation', () => {
    expect(() => controller.review('model', { status: 'approved' }, {} as any)).toThrow(UnauthorizedException);
    expect(manager.review).not.toHaveBeenCalled();
  });
});
