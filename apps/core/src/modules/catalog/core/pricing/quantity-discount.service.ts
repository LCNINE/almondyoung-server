import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../catalog.types';
import { QuantityDiscountReader, QuantityDiscountReadModel } from './quantity-discount.reader';
import { QuantityDiscountInput, QuantityDiscountManager } from './quantity-discount.manager';

@Injectable()
export class QuantityDiscountService {
  constructor(
    private readonly reader: QuantityDiscountReader,
    private readonly manager: QuantityDiscountManager,
  ) {}

  getForVersion(masterId: string, versionId: string, tx?: DbTransaction): Promise<QuantityDiscountReadModel | null> {
    return this.reader.findForVersion(masterId, versionId, tx);
  }

  upsertForDraft(
    masterId: string,
    versionId: string,
    input: QuantityDiscountInput,
    tx?: DbTransaction,
  ): Promise<QuantityDiscountReadModel | null> {
    return this.manager.upsertForDraft(masterId, versionId, input, tx);
  }
}
