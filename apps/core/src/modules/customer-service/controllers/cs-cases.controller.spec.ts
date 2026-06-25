import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CsCaseCommentsController } from './cs-case-comments.controller';
import { CsCaseLabelsController } from './cs-case-labels.controller';
import { CsCasesController } from './cs-cases.controller';
import { CsLabelsController } from './cs-labels.controller';

function expectRoleGuarded(controller: object) {
  const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined;
  expect(guards?.length).toBeGreaterThan(0);
}

describe('CsCasesController', () => {
  function makeController() {
    const service = {
      create: jest.fn(),
      list: jest.fn(),
      getOne: jest.fn(),
      createBusinessLink: jest.fn(),
      updateStatus: jest.fn(),
      assign: jest.fn(),
    };
    return { controller: new CsCasesController(service as any), service };
  }

  it('uses the authenticated user id as the creator', () => {
    const { controller, service } = makeController();
    controller.create({ subject: 'x' } as any, { id: 'u-1' });
    expect(service.create).toHaveBeenCalledWith({ subject: 'x' }, 'u-1');
  });

  it('delegates status update with the operator id', () => {
    const { controller, service } = makeController();
    controller.updateStatus('case-1', { status: 'closed' } as any, { sub: 'u-9' });
    expect(service.updateStatus).toHaveBeenCalledWith('case-1', 'closed', 'u-9');
  });

  it('delegates assignment with the operator id', () => {
    const { controller, service } = makeController();
    controller.assign('case-1', { assigneeId: 'agent-2' } as any, { userId: 'u-3' });
    expect(service.assign).toHaveBeenCalledWith('case-1', 'agent-2', 'u-3');
  });

  it('protects all customer-service controllers with role guards', () => {
    expectRoleGuarded(CsCasesController);
    expectRoleGuarded(CsCaseCommentsController);
    expectRoleGuarded(CsCaseLabelsController);
    expectRoleGuarded(CsLabelsController);
  });
});
