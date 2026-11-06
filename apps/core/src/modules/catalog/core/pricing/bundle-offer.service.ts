import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../catalog.types';
import { BundleOfferInput } from './bundle-offer.math';
import { BundleOfferManager } from './bundle-offer.manager';
import { BundleOfferReader, BundleOfferReadModel } from './bundle-offer.reader';

@Injectable()
export class BundleOfferService {
  constructor(
    private readonly reader: BundleOfferReader,
    private readonly manager: BundleOfferManager,
  ) {}

  getForMaster(masterId: string, tx?: DbTransaction): Promise<BundleOfferReadModel[]> {
    return this.reader.findForMaster(masterId, tx);
  }

  replaceForMaster(masterId: string, offers: BundleOfferInput[], tx?: DbTransaction): Promise<BundleOfferReadModel[]> {
    return this.manager.replaceForMaster(masterId, offers, tx);
  }
}
