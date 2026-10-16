import { Module } from '@nestjs/common';
import { PrintFileClient } from './clients/print-file.client';
import { PublicFileClient } from './clients/public-file.client';
import { AdminAlmondDesignsController } from './controllers/admin-almond-designs.controller';
import { InternalAlmondDesignsController } from './controllers/internal-almond-designs.controller';
import { AdminAlmondTemplatesController } from './controllers/admin-almond-templates.controller';
import { AlmondDesignsController } from './controllers/almond-designs.controller';
import { AlmondSavedDesignsController } from './controllers/almond-saved-designs.controller';
import { AlmondSavedDesignWithdrawalConsumer } from './consumers/almond-saved-design-withdrawal.consumer';
import { PublicAlmondTemplatesController } from './controllers/public-almond-templates.controller';
import { AlmondPrintRenderer } from './print/almond-print.renderer';
import { AlmondDesignManager } from './services/almond-design.manager';
import { AlmondDesignPrinter } from './services/almond-design.printer';
import { AlmondDesignReader } from './services/almond-design.reader';
import { AlmondDesignsService } from './services/almond-designs.service';
import { AlmondPrintFileManager } from './services/almond-print-file.manager';
import { AlmondSavedDesignManager } from './services/almond-saved-design.manager';
import { AlmondSavedDesignReader } from './services/almond-saved-design.reader';
import { AlmondSavedDesignsService } from './services/almond-saved-designs.service';
import { AlmondTemplateManager } from './services/almond-template.manager';
import { AlmondTemplateReader } from './services/almond-template.reader';
import { AlmondTemplatesService } from './services/almond-templates.service';

@Module({
  controllers: [
    PublicAlmondTemplatesController,
    AdminAlmondTemplatesController,
    AlmondDesignsController,
    AdminAlmondDesignsController,
    InternalAlmondDesignsController,
    AlmondSavedDesignsController,
    AlmondSavedDesignWithdrawalConsumer,
  ],
  providers: [
    AlmondTemplatesService,
    AlmondTemplateReader,
    AlmondTemplateManager,
    AlmondDesignsService,
    AlmondDesignReader,
    AlmondDesignManager,
    AlmondDesignPrinter,
    AlmondPrintRenderer,
    PublicFileClient,
    PrintFileClient,
    AlmondPrintFileManager,
    AlmondSavedDesignsService,
    AlmondSavedDesignReader,
    AlmondSavedDesignManager,
  ],
})
export class AlmondTemplateModule {}
