import { Module } from '@nestjs/common';
import { AdminAlmondTemplatesController } from './controllers/admin-almond-templates.controller';
import { PublicAlmondTemplatesController } from './controllers/public-almond-templates.controller';
import { AlmondTemplateManager } from './services/almond-template.manager';
import { AlmondTemplateReader } from './services/almond-template.reader';
import { AlmondTemplatesService } from './services/almond-templates.service';

@Module({
  controllers: [PublicAlmondTemplatesController, AdminAlmondTemplatesController],
  providers: [AlmondTemplatesService, AlmondTemplateReader, AlmondTemplateManager],
})
export class AlmondTemplateModule {}
