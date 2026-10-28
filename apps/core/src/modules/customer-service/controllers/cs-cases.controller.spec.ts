import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { PATH_METADATA } from '@nestjs/common/constants';
import { CsCaseCommentsController } from './cs-case-comments.controller';
import { CsCaseLabelsController } from './cs-case-labels.controller';
import { CsCasesController } from './cs-cases.controller';
import { CsLabelsController } from './cs-labels.controller';

function expectPermissionOnEveryRoute(controller: { prototype: object }) {
  const routes = Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name): unknown => Object.getOwnPropertyDescriptor(controller.prototype, name)?.value)
    .filter((handler): handler is object => typeof handler === 'function')
    .filter((handler) => Reflect.getMetadata(PATH_METADATA, handler) !== undefined);
  expect(routes.length).toBeGreaterThan(0);
  for (const handler of routes) {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual([expect.stringMatching(/^cs\./)]);
  }
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

  it('protects every customer-service route with a permission', () => {
    expectPermissionOnEveryRoute(CsCasesController);
    expectPermissionOnEveryRoute(CsCaseCommentsController);
    expectPermissionOnEveryRoute(CsCaseLabelsController);
    expectPermissionOnEveryRoute(CsLabelsController);
  });
});
