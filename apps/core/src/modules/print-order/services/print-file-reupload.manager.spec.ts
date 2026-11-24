import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { outboundTenantForTesting } from '@app/tenancy';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '@app/shared';
import { type DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  CustomerPrintFileClient,
  CustomerPrintFileNotFoundError,
  type CustomerPrintFile,
} from '../clients/customer-print-file.client';
import { PrintProductSpecRepository } from '../repositories/print-product-spec.repository';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressClient } from '../wowpress/wowpress.client';
import { type WowpressLineSpec } from '../wowpress/wowpress.types';
import { PrintFileReuploadManager } from './print-file-reupload.manager';
import { PrintOrderRepository, type PrintOrderLineContext } from './print-order.repository';

const CUSTOMER = 'customer-1';
const LINE = '0190f1d2-0000-7000-8000-00000000b001';
const NEW_FILE = 'file-new';
const REJECTED_AT = new Date('2026-11-24T00:00:00Z');
const noDb = {} as unknown as DbService<typeof wmsSchema>;

class FakeRepo extends PrintOrderRepository {
  row: PrintOrderRow | null = {
    id: 'po-1',
    salesOrderLineId: LINE,
    printFileId: 'file-old',
    fileRejectedAt: REJECTED_AT,
    vendorOrderNumber: 'W-1',
    status: 'submitted',
  } as PrintOrderRow;
  context: PrintOrderLineContext = {
    line: { id: LINE, variantId: 'v-1', quantity: 1 },
    order: { channelOrderId: 'order_1', customerId: CUSTOMER, shippingAddress: {} },
  };
  constructor() {
    super(noDb);
  }
  override withLockedLine<T>(_lineId: string, fn: (row: PrintOrderRow | null, tx: DbTx) => Promise<T>): Promise<T> {
    return fn(this.row, {} as DbTx);
  }
  findLineContext = jest.fn(() => Promise.resolve(this.context));
  recordResubmittedFile = jest.fn<Promise<boolean>, [string, string, unknown]>(() => Promise.resolve(true));
}

class FakeSpecs extends PrintProductSpecRepository {
  constructor() {
    super(noDb);
  }
  findSpec = jest.fn(() => Promise.resolve({ prodno: 40572 } as WowpressLineSpec));
}

class FakeFiles extends CustomerPrintFileClient {
  constructor() {
    super(new ConfigService({}), outboundTenantForTesting(undefined));
  }
  describe = jest.fn<Promise<CustomerPrintFile>, [string, string]>(() =>
    Promise.resolve({ ownerId: CUSTOMER, isPrintFile: true, fileName: '청첩장 수정본.eps' }),
  );
  link = jest.fn<Promise<string>, [string, string]>(() => Promise.resolve('https://s3/new.eps'));
}

class FakeWowpress extends WowpressClient {
  constructor() {
    super(new ConfigService({}), () => Promise.reject(new Error('real wowpress call in test')));
  }
  uploadFileUrl = jest.fn<Promise<void>, [string, string, string]>(() => Promise.resolve());
}

function setup() {
  const repo = new FakeRepo();
  const files = new FakeFiles();
  const wowpress = new FakeWowpress();
  const manager = new PrintFileReuploadManager(repo, new FakeSpecs(), files, wowpress);
  return { repo, files, wowpress, manager };
}

describe('PrintFileReuploadManager', () => {
  it('sends the new file to the same wowpress order, then records it', async () => {
    const { repo, wowpress, manager } = setup();

    await manager.reupload(CUSTOMER, LINE, NEW_FILE);

    expect(wowpress.uploadFileUrl).toHaveBeenCalledWith('W-1', `${LINE}.eps`, 'https://s3/new.eps');
    expect(repo.recordResubmittedFile).toHaveBeenCalledWith('po-1', NEW_FILE, expect.anything());
  });

  it("hides another customer's print", async () => {
    const { repo, manager } = setup();
    repo.context = { ...repo.context, order: { ...repo.context.order, customerId: 'someone-else' } };

    await expect(manager.reupload(CUSTOMER, LINE, NEW_FILE)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a line that wowpress did not send back', async () => {
    const { repo, manager } = setup();
    repo.row = { ...repo.row!, fileRejectedAt: null };

    await expect(manager.reupload(CUSTOMER, LINE, NEW_FILE)).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not upload for an order that left tracking (e.g. cancelled)', async () => {
    const { repo, wowpress, manager } = setup();
    repo.row = { ...repo.row!, status: 'cancelled' };

    await expect(manager.reupload(CUSTOMER, LINE, NEW_FILE)).rejects.toBeInstanceOf(ConflictError);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['a file of someone else', { ownerId: 'someone-else' }],
    ['a file uploaded for another purpose', { isPrintFile: false }],
    ['a file type the product does not take', { fileName: 'card.pdf' }],
  ])('refuses %s', async (_label, patch) => {
    const { files, wowpress, manager } = setup();
    files.describe.mockResolvedValue({ ownerId: CUSTOMER, isPrintFile: true, fileName: 'a.eps', ...patch });

    await expect(manager.reupload(CUSTOMER, LINE, NEW_FILE)).rejects.toBeInstanceOf(BadRequestError);
    expect(wowpress.uploadFileUrl).not.toHaveBeenCalled();
  });

  it("a missing file is the customer's mistake, not an outage", async () => {
    const { files, manager } = setup();
    files.describe.mockRejectedValue(new CustomerPrintFileNotFoundError('gone'));

    await expect(manager.reupload(CUSTOMER, LINE, NEW_FILE)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('keeps the notice when wowpress does not take the file, so the customer can try again', async () => {
    const { repo, wowpress, manager } = setup();
    wowpress.uploadFileUrl.mockRejectedValue(new Error('upload down'));

    await expect(manager.reupload(CUSTOMER, LINE, NEW_FILE)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(repo.recordResubmittedFile).not.toHaveBeenCalled();
  });
});
