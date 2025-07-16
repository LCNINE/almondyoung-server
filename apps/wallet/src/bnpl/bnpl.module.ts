import { Module } from '@nestjs/common';
import { BnplController } from './bnpl.controller';
import { BnplService } from './bnpl.service';
import { HmsBnplService } from './services/hms-bnpl.service';
import { BnplAccountService } from './services/bnpl-account.service';
import { BnplSettlementService } from './services/bnpl-settlement.service';
import { BnplCreditService } from './services/bnpl-credit.service';
import { SharedModule } from '@app/shared';

@Module({
  imports: [SharedModule],
  controllers: [BnplController],
  providers: [
    BnplService,
    HmsBnplService,
    BnplAccountService,
    BnplSettlementService,
    BnplCreditService,
  ],
  exports: [BnplService],
})
export class BnplModule {}