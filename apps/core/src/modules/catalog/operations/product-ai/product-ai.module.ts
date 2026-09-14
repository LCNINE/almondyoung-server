import { ProductAiImageService } from './services/product-ai-image.service';
import { Module } from '@nestjs/common';
import { ProductAiController } from './controllers/product-ai.controller';
import { ProductAiService } from './services/product-ai.service';
import { ProductAiProvider } from './providers/product-ai.provider';
import { ProductAiReplyService } from './services/product-ai.reply.service';
import { ProductsModule } from '../../core/products/products.module';
import { ProductAiDraftService } from './services/product-ai-draft.service';
import { ProductAiSalesService } from './services/product-ai-sales.service';
import { PricingModule } from '../../core/pricing/pricing.module';
import { CategoriesModule } from '../../core/categories/categories.module';
import { ProductMatchingModule } from '../../../product-matching/product-matching.module';

@Module({
  imports: [ProductsModule, PricingModule, CategoriesModule, ProductMatchingModule],
  controllers: [ProductAiController],
  providers: [
    ProductAiSalesService,
    ProductAiImageService,
    ProductAiService,
    ProductAiProvider,
    ProductAiReplyService,
    ProductAiDraftService,
  ],
})
export class ProductAiModule {}
