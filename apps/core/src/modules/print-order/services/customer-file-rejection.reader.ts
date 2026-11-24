import { Injectable } from '@nestjs/common';
import { CUSTOMER_FILE_EXTENSIONS } from '../print-source';
import { PrintProductSpecRepository } from '../repositories/print-product-spec.repository';
import { WOWPRESS_PRODUCTS } from '../wowpress/wowpress-products';
import { PrintOrderReader, type CustomerFileRejection } from './print-order.reader';

export interface CustomerFileRejectionView extends Omit<CustomerFileRejection, 'variantId'> {
  // 다시 올릴 때 받는 확장자. 화면이 상품 종류를 몰라도 고를 수 있게 같이 내려준다
  acceptedExtensions: string[];
}

@Injectable()
export class CustomerFileRejectionReader {
  constructor(
    private readonly reader: PrintOrderReader,
    private readonly specs: PrintProductSpecRepository,
  ) {}

  async forCustomer(customerId: string): Promise<CustomerFileRejectionView[]> {
    const rows = await this.reader.customerFileRejections(customerId);

    return Promise.all(
      rows.map(async ({ variantId, ...row }) => {
        const spec = (await this.specs.findSpec(variantId)) ?? WOWPRESS_PRODUCTS[variantId];

        return { ...row, acceptedExtensions: spec ? [...(CUSTOMER_FILE_EXTENSIONS[spec.prodno] ?? [])] : [] };
      }),
    );
  }
}
