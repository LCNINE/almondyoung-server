import { Module } from '@nestjs/common';
import { CsCasesController } from './controllers/cs-cases.controller';
import { CsCasesService } from './services/cs-cases.service';

@Module({
  controllers: [CsCasesController],
  providers: [CsCasesService],
  exports: [CsCasesService],
})
export class CustomerServiceModule {}
