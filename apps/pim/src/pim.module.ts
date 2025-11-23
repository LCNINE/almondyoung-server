import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { validatePimEnv } from './config/env.validation';
import { pimSchema } from './schema';

// Root level
import { PimController } from './pim.controller';
import { PimService } from './pim.service';

// Feature modules
import { CategoriesModule } from './core/categories/categories.module';
import { ProductsModule } from './core/products/products.module';
import { ChannelsModule } from './core/channels/channels.module';
import { PricingModule } from './core/pricing/pricing.module';
import { TagsModule } from './core/tags/tags.module';
import { ApprovalModule } from './operations/approval/approval.module';
import { BulkModule } from './operations/bulk/bulk.module';
import { CsvModule } from './operations/csv/csv.module';
import { AuditModule } from './operations/audit/audit.module';
import { DashboardModule } from './analytics/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validatePimEnv,
    }),
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_uZH3erzXIdR6@ep-plain-tooth-a1jtqmyb-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: pimSchema,
    }),
    EventsModule.forRoot({
      streams: [PRODUCT_STREAM],
      serviceName: 'pim',
      enableDLQ: true,
    }),
    // Core domain modules
    CategoriesModule,
    ProductsModule,
    ChannelsModule,
    PricingModule,
    TagsModule,
    // Operations modules
    ApprovalModule,
    BulkModule,
    CsvModule,
    AuditModule,
    // Analytics modules
    DashboardModule,
  ],
  controllers: [PimController],
  providers: [PimService],
})
export class PimModule {}
