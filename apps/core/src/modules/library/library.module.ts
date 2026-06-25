import { Module } from '@nestjs/common';

import { DigitalAssetController } from './controllers/digital-asset.controller';
import { VariantAssetLinkController } from './controllers/variant-asset-link.controller';
import { OwnershipController } from './controllers/ownership.controller';
import { OwnershipAdminController } from './controllers/ownership-admin.controller';
import { DigitalAssetService } from './services/digital-asset.service';
import { VariantAssetLinkService } from './services/variant-asset-link.service';
import { LibraryService } from './services/library.service';
import { OwnershipService } from './services/ownership.service';
import { FileServiceClient } from './clients/file-service.client';

@Module({
  controllers: [
    DigitalAssetController,
    VariantAssetLinkController,
    OwnershipController,
    OwnershipAdminController,
  ],
  providers: [
    DigitalAssetService,
    VariantAssetLinkService,
    LibraryService,
    OwnershipService,
    FileServiceClient,
  ],
  exports: [DigitalAssetService, VariantAssetLinkService, LibraryService],
})
export class LibraryModule {}
