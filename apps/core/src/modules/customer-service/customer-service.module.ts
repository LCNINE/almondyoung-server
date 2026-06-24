import { Module } from '@nestjs/common';
import { CsCasesController } from './controllers/cs-cases.controller';
import { CsCaseCommentsController } from './controllers/cs-case-comments.controller';
import { CsCaseLabelsController } from './controllers/cs-case-labels.controller';
import { CsLabelsController } from './controllers/cs-labels.controller';
import { CsCasesService } from './services/cs-cases.service';
import { CsCommentsService } from './services/cs-comments.service';
import { CsLabelsService } from './services/cs-labels.service';

@Module({
  controllers: [CsCasesController, CsCaseCommentsController, CsCaseLabelsController, CsLabelsController],
  providers: [CsCasesService, CsCommentsService, CsLabelsService],
  exports: [CsCasesService, CsCommentsService, CsLabelsService],
})
export class CustomerServiceModule {}
