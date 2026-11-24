import { Module } from '@nestjs/common';
import { CsCasesController } from './controllers/cs-cases.controller';
import { CsCaseCommentsController } from './controllers/cs-case-comments.controller';
import { CsCaseLabelsController } from './controllers/cs-case-labels.controller';
import { CsLabelsController } from './controllers/cs-labels.controller';
import { OrderContactsController } from './controllers/order-contacts.controller';
import { CsCasesService } from './services/cs-cases.service';
import { CsCommentsService } from './services/cs-comments.service';
import { CsLabelsService } from './services/cs-labels.service';
import { OrderContactsManager } from './services/order-contacts.manager';
import { OrderContactsReader } from './services/order-contacts.reader';
import { OrderContactsService } from './services/order-contacts.service';

@Module({
  controllers: [
    CsCasesController,
    CsCaseCommentsController,
    CsCaseLabelsController,
    CsLabelsController,
    OrderContactsController,
  ],
  providers: [
    CsCasesService,
    CsCommentsService,
    CsLabelsService,
    OrderContactsManager,
    OrderContactsReader,
    OrderContactsService,
  ],
  exports: [CsCasesService, CsCommentsService, CsLabelsService],
})
export class CustomerServiceModule {}
