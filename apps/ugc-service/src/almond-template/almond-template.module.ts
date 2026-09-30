import { Module } from '@nestjs/common';
import { PublicFileClient } from './clients/public-file.client';
import { AdminAlmondDesignsController } from './controllers/admin-almond-designs.controller';
import { AdminAlmondTemplatesController } from './controllers/admin-almond-templates.controller';
import { AlmondDesignsController } from './controllers/almond-designs.controller';
import { PublicAlmondTemplatesController } from './controllers/public-almond-templates.controller';
import { AlmondPrintRenderer } from './print/almond-print.renderer';
import { AlmondDesignManager } from './services/almond-design.manager';
import { AlmondDesignPrinter } from './services/almond-design.printer';
import { AlmondDesignReader } from './services/almond-design.reader';
import { AlmondDesignsService } from './services/almond-designs.service';
import { AlmondTemplateManager } from './services/almond-template.manager';
import { AlmondTemplateReader } from './services/almond-template.reader';
import { AlmondTemplatesService } from './services/almond-templates.service';

@Module({
  controllers: [
    PublicAlmondTemplatesController,
    AdminAlmondTemplatesController,
    AlmondDesignsController,
    AdminAlmondDesignsController,
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
  ],
})
export class AlmondTemplateModule {}
