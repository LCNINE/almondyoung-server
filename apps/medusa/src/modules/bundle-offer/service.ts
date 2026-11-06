import { MedusaService } from '@medusajs/framework/utils';
import BundleOffer from './models/bundle-offer';
import BundleOfferRevision from './models/bundle-offer-revision';

class BundleOfferModuleService extends MedusaService({ BundleOffer, BundleOfferRevision }) {}

export default BundleOfferModuleService;
