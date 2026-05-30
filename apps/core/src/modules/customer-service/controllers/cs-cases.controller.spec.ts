import { CsCasesController } from './cs-cases.controller';

describe('CsCasesController', () => {
  function makeController() {
    const service = {
      create: jest.fn(),
      list: jest.fn(),
      getOne: jest.fn(),
      createBusinessLink: jest.fn(),
    };
    return { controller: new CsCasesController(service as any), service };
  }

  it('uses the authenticated user id as the CS Case creator', () => {
    const { controller, service } = makeController();
    const dto = { subject: 'Need cancellation review' };

    controller.create(dto, { id: '11111111-1111-4111-8111-111111111111' });

    expect(service.create).toHaveBeenCalledWith(dto, '11111111-1111-4111-8111-111111111111');
  });

  it('falls back to userId/sub shapes used by existing auth call sites', () => {
    const { controller, service } = makeController();
    const dto = { subject: 'Need fulfillment review' };

    controller.create(dto, { userId: '22222222-2222-4222-8222-222222222222' });
    controller.create(dto, { sub: '33333333-3333-4333-8333-333333333333' });

    expect(service.create).toHaveBeenNthCalledWith(1, dto, '22222222-2222-4222-8222-222222222222');
    expect(service.create).toHaveBeenNthCalledWith(2, dto, '33333333-3333-4333-8333-333333333333');
  });

  it('passes a numeric list limit to the service', () => {
    const { controller, service } = makeController();

    controller.list(20);

    expect(service.list).toHaveBeenCalledWith(20);
  });
});
