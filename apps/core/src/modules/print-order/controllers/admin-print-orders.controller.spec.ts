import { type ArgumentMetadata } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import {
  ConfirmPrintTestDto,
  ListPrintOrdersQueryDto,
  ResolvePrintCancelDto,
  RetryPrintOrderDto,
} from '../dto/admin-print-orders.dto';
import { PrintOrdersService } from '../services/print-orders.service';
import { AdminPrintOrdersController } from './admin-print-orders.controller';

const ADMIN = { userId: 'admin-1', roles: ['admin'] };

function validate<T>(metatype: new () => T, value: unknown, type: ArgumentMetadata['type'] = 'body'): Promise<T> {
  return createGlobalValidationPipe().transform(value, { type, metatype });
}

function setup() {
  const service = {
    summary: jest.fn().mockResolvedValue({ cancelRefused: 0, testPending: 0, failed: 0, unsupported: 0, total: 0 }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    byLine: jest.fn().mockResolvedValue({ id: 'po-1' }),
    byDesign: jest.fn().mockResolvedValue([]),
    retry: jest.fn().mockResolvedValue({ id: 'po-1' }),
    confirmTest: jest.fn().mockResolvedValue({ id: 'po-1' }),
    resolveCancel: jest.fn().mockResolvedValue({ printOrder: { id: 'po-1' }, salesCancel: null }),
  };
  // 컨트롤러는 위임만 하므로 서비스 자리를 메서드 가짜로 채운다
  const controller = new AdminPrintOrdersController(service as unknown as PrintOrdersService);
  return { service, controller };
}

describe('AdminPrintOrdersController', () => {
  it('lists with defaults: all tab, empty search, first page', async () => {
    const { service, controller } = setup();
    await controller.list(await validate(ListPrintOrdersQueryDto, {}, 'query'));
    expect(service.list).toHaveBeenCalledWith({ tab: 'all', q: '', page: 1, pageSize: 50 });
  });

  it('passes tab, search and page through', async () => {
    const { service, controller } = setup();
    await controller.list(
      await validate(ListPrintOrdersQueryDto, { tab: 'cancel_refused', q: '3900', page: '2', pageSize: '20' }, 'query'),
    );
    expect(service.list).toHaveBeenCalledWith({ tab: 'cancel_refused', q: '3900', page: 2, pageSize: 20 });
  });

  it.each([{ page: '10001' }, { page: '0' }, { pageSize: '101' }, { pageSize: '0' }])(
    'rejects out-of-range paging %p',
    async (query) => {
      await expect(validate(ListPrintOrdersQueryDto, query, 'query')).rejects.toBeDefined();
    },
  );

  it('rejects an unknown tab', async () => {
    await expect(validate(ListPrintOrdersQueryDto, { tab: 'everything' }, 'query')).rejects.toBeDefined();
  });

  it('retries as the authenticated admin, without confirmation unless asked', async () => {
    const { service, controller } = setup();
    await controller.retry('po-1', await validate(RetryPrintOrderDto, {}), ADMIN);
    await controller.retry('po-1', await validate(RetryPrintOrderDto, { confirmNoWowpressOrder: true }), ADMIN);
    expect(service.retry).toHaveBeenNthCalledWith(1, 'po-1', ADMIN, false);
    expect(service.retry).toHaveBeenNthCalledWith(2, 'po-1', ADMIN, true);
  });

  it('requires a non-empty note to confirm a test', async () => {
    await expect(validate(ConfirmPrintTestDto, {})).rejects.toBeDefined();
    await expect(validate(ConfirmPrintTestDto, { note: '   ' })).rejects.toBeDefined();
    const { service, controller } = setup();
    await controller.confirmTest('po-1', await validate(ConfirmPrintTestDto, { note: ' 출력 가능 ' }), ADMIN);
    expect(service.confirmTest).toHaveBeenCalledWith('po-1', ADMIN, '출력 가능');
  });

  it('accepts only cancelled or proceed as the resolution', async () => {
    await expect(validate(ResolvePrintCancelDto, { outcome: 'refund' })).rejects.toBeDefined();
    const { service, controller } = setup();
    await controller.resolveCancel('po-1', await validate(ResolvePrintCancelDto, { outcome: 'proceed' }), ADMIN);
    expect(service.resolveCancel).toHaveBeenCalledWith('po-1', 'proceed', ADMIN);
  });

  it('delegates summary and by-line lookups', async () => {
    const { service, controller } = setup();
    await controller.summary();
    await controller.byLine('line-1');
    await controller.byDesign('design-1');
    expect(service.summary).toHaveBeenCalled();
    expect(service.byLine).toHaveBeenCalledWith('line-1');
    expect(service.byDesign).toHaveBeenCalledWith('design-1');
  });
});
