import { Module } from '@nestjs/common';

// Controllers
import { TaxInvoiceController } from '../controllers/tax-invoice.controller';
import { TaxInvoiceAdminController } from '../controllers/tax-invoice-admin.controller';

// Services
import { TaxInvoiceService } from '../services/tax/tax-invoice.service';
import { TaxInvoiceAdminService } from '../services/tax/tax-invoice-admin.service';
import { TaxInvoicePreferenceService } from '../services/tax/tax-invoice-preference.service';

// Readers, Creators, Managers
import { TaxInvoiceReader } from '../services/tax/tax-invoice.reader';
import { TaxInvoiceCreator } from '../services/tax/tax-invoice.creator';
import { TaxInvoiceManager } from '../services/tax/tax-invoice.manager';

// Repository (Unified)
import { TaxInvoiceRepository } from '../services/tax/tax-invoice.repository';

// OMS Client
import { OmsClientMock } from '../services/tax/oms-client.mock';

/**
 * TaxInvoiceModule
 *
 * 세금계산서 시스템 모듈
 * - 사용자: 신청, 조회, 기본 설정
 * - 관리자: 발행 관리 (엑셀 내보내기, 발행 완료/실패, 취소)
 */
@Module({
  imports: [],
  controllers: [TaxInvoiceController, TaxInvoiceAdminController],
  providers: [
    // Main Services
    TaxInvoiceService,
    TaxInvoiceAdminService,
    TaxInvoicePreferenceService,

    // Implementation Layer
    TaxInvoiceReader,
    TaxInvoiceCreator,
    TaxInvoiceManager,

    // Data Access Layer (Unified Repository)
    TaxInvoiceRepository,

    // OMS Client (Mock - OMS는 다른 팀 담당)
    {
      provide: 'OMS_CLIENT',
      useClass: OmsClientMock,
    },
  ],
  exports: [
    TaxInvoiceService,
    TaxInvoiceAdminService,
    TaxInvoicePreferenceService,
  ],
})
export class TaxInvoiceModule {}
