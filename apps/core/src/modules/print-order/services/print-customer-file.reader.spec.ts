import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { outboundTenantForTesting } from '@app/tenancy';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  CustomerPrintFileClient,
  CustomerPrintFileNotFoundError,
  type CustomerPrintFile,
} from '../clients/customer-print-file.client';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { PrintCustomerFileReader } from './print-customer-file.reader';
import { PrintOrderRepository, type PrintOrderLineContext } from './print-order.repository';

const CUSTOMER = 'customer-1';

class FakeRepo extends PrintOrderRepository {
  row: PrintOrderRow | null = { id: 'po-1', salesOrderLineId: 'line-1', printFileId: 'file-1' } as PrintOrderRow;
  customerId: string | null = CUSTOMER;
  constructor() {
    super({} as unknown as DbService<typeof wmsSchema>);
  }
  findById = jest.fn(() => Promise.resolve(this.row));
  findLineContext = jest.fn(() =>
    Promise.resolve({
      line: { id: 'line-1', variantId: 'v-1', quantity: 1 },
      order: { channelOrderId: 'order_1', customerId: this.customerId, shippingAddress: {} },
    } as PrintOrderLineContext),
  );
}

class FakeFiles extends CustomerPrintFileClient {
  constructor() {
    super(new ConfigService({}), outboundTenantForTesting(undefined));
  }
  describe = jest.fn<Promise<CustomerPrintFile>, [string, string]>(() =>
    Promise.resolve({ ownerId: CUSTOMER, isPrintFile: true, fileName: '청첩장.ai' }),
  );
  downloadLink = jest.fn<Promise<string>, [string, string]>(() => Promise.resolve('https://s3/download'));
}

function setup() {
  const repo = new FakeRepo();
  const files = new FakeFiles();
  return { repo, files, reader: new PrintCustomerFileReader(repo, files) };
}

describe('PrintCustomerFileReader', () => {
  it('reads the file on behalf of the ordering customer and keeps its name', async () => {
    const { files, reader } = setup();

    await expect(reader.link('po-1')).resolves.toEqual({ url: 'https://s3/download' });
    expect(files.downloadLink).toHaveBeenCalledWith('file-1', CUSTOMER);
  });

  it.each([
    ['an almond design line', (repo: FakeRepo) => (repo.row = { ...repo.row!, printFileId: null })],
    ['an order without a customer', (repo: FakeRepo) => (repo.customerId = null)],
    ['a missing print order', (repo: FakeRepo) => (repo.row = null)],
  ])('has no customer file for %s', async (_label, arrange) => {
    const { repo, reader } = setup();
    arrange(repo);

    await expect(reader.link('po-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not hide other file-service failures as not found', async () => {
    const { files, reader } = setup();
    files.downloadLink.mockRejectedValue(new Error('file-service down'));

    await expect(reader.link('po-1')).rejects.not.toBeInstanceOf(NotFoundError);
  });

  it('treats a deleted file as not found', async () => {
    const { files, reader } = setup();
    files.downloadLink.mockRejectedValue(new CustomerPrintFileNotFoundError('gone'));

    await expect(reader.link('po-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
