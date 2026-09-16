import { randomUUID } from 'node:crypto';
import { DbService } from '@app/db';
import { inventorySchema } from '../../../../inventory/schema/inventory.schema';
import { DemoCarrierRepository } from './demo-carrier.repository';

const describeDb = process.env.REQUIRE_DEMO_LOGISTICS_SEED_DB === '1' ? describe : describe.skip;

describeDb('DemoCarrierRepository transitions', () => {
  let dbService: DbService<typeof inventorySchema>;
  let repository: DemoCarrierRepository;

  beforeAll(() => {
    const configuredUrl = process.env.DEMO_LOGISTICS_SEED_DATABASE_URL;
    if (!configuredUrl) throw new Error('DEMO_LOGISTICS_SEED_DATABASE_URL is required when DB integration is enabled');
    const runtimeDatabaseUrl = new URL(configuredUrl);
    runtimeDatabaseUrl.searchParams.delete('uselibpqcompat');
    dbService = new DbService({ connectionString: runtimeDatabaseUrl.toString() }, inventorySchema);
    repository = new DemoCarrierRepository(dbService);
  });

  afterAll(async () => {
    await dbService?.onModuleDestroy();
  });

  it('keeps cancel terminal and makes concurrent registration idempotent', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 11);
    const canceled = await repository.allocate({
      requestKey: `integration-cancel-${suffix}`,
      requestHash: 'a'.repeat(64),
      waybillNo: `8${suffix}`,
      labelData: { demo: true },
    });
    await expect(repository.cancel(canceled.waybillNo)).resolves.toBe(true);
    await expect(repository.register(canceled.waybillNo)).resolves.toBe('canceled');

    const concurrent = await repository.allocate({
      requestKey: `integration-register-${suffix}`,
      requestHash: 'b'.repeat(64),
      waybillNo: `7${suffix}`,
      labelData: { demo: true },
    });
    await expect(
      Promise.all([repository.register(concurrent.waybillNo), repository.register(concurrent.waybillNo)]),
    ).resolves.toEqual(expect.arrayContaining(['registered', 'already_registered']));
  });
});
