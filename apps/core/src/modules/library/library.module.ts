import { Module } from '@nestjs/common';

import { DigitalAssetController } from './controllers/digital-asset.controller';
import { VariantAssetLinkController } from './controllers/variant-asset-link.controller';
import { DigitalAssetService } from './services/digital-asset.service';
import { VariantAssetLinkService } from './services/variant-asset-link.service';

@Module({
  controllers: [DigitalAssetController, VariantAssetLinkController],
  providers: [DigitalAssetService, VariantAssetLinkService],
  exports: [DigitalAssetService, VariantAssetLinkService],
})
export class LibraryModule {}
