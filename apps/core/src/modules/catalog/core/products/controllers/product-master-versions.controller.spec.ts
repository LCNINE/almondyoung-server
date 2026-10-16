import { ProductMasterVersionsController } from './product-master-versions.controller';

describe('ProductMasterVersionsController publish options', () => {
  it('forwards guarded bulk options and acknowledges the origin', async () => {
    const service = { publishVersion: jest.fn().mockResolvedValue(undefined) };
    const controller = new ProductMasterVersionsController(service as any, {} as any, {} as any);
    const dto = { origin: 'bulk_import' as const, expectedActiveVersionId: 'expected' };

    await expect(controller.publishVersion('master', 'draft', { userId: 'admin' }, dto)).resolves.toEqual({
      message: 'Version published successfully',
      origin: 'bulk_import',
    });
    expect(service.publishVersion).toHaveBeenCalledWith('draft', 'admin', undefined, dto);
  });

  it('keeps an empty-body publication compatible', async () => {
    const service = { publishVersion: jest.fn().mockResolvedValue(undefined) };
    const controller = new ProductMasterVersionsController(service as any, {} as any, {} as any);

    await expect(controller.publishVersion('master', 'draft', { userId: 'admin' })).resolves.toEqual({
      message: 'Version published successfully',
    });
    expect(service.publishVersion).toHaveBeenCalledWith('draft', 'admin', undefined, {});
  });
});
