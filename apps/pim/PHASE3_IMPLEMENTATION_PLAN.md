# Phase 3 Implementation Plan - Advanced Features

**Status**: Ready to Execute  
**Duration**: Week 4  
**Prerequisites**: Phase 2 completed

---

## Overview

Phase 3 implements two major advanced features:
1. **CSV Bulk Import/Export** - Enable bulk product management via CSV files
2. **Product Audit Logging** - Track all product changes with detailed audit trails

---

## Feature 3.1: CSV Bulk Import/Export

### Goals
- Allow bulk product creation via CSV upload
- Enable product data export to CSV format
- Provide CSV template download for users
- Validate CSV data before import
- Handle import errors gracefully

### Implementation Steps

#### Step 3.1.1: Install Dependencies

```bash
npm install papaparse
npm install --save-dev @types/papaparse
npm install @nestjs/platform-express multer
npm install --save-dev @types/multer
```

**Verification**: Check `package.json` for added dependencies

---

#### Step 3.1.2: Update Schema for Audit Log Table

**File**: `apps/pim/src/schema.ts`

Add the `productAuditLog` table if not already present:

```typescript
export const productAuditLog = pgTable(
  'product_audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    productId: uuid('product_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(), // 'created', 'updated', 'deleted', 'restored', 'imported'
    changes: jsonb('changes').$type<Record<string, any>>(), // Field-level changes
    userId: uuid('user_id').notNull(),
    userEmail: varchar('user_email', { length: 255 }), // Denormalized for audit
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    ipAddress: varchar('ip_address', { length: 45 }), // IPv4 or IPv6
    userAgent: text('user_agent'),
  },
  (table) => [
    index('idx_audit_log_product').on(table.productId),
    index('idx_audit_log_action').on(table.action),
    index('idx_audit_log_timestamp').on(table.timestamp),
    index('idx_audit_log_user').on(table.userId),
  ],
);
```

Update schema exports:

```typescript
export const pimSchema = {
  // ... existing tables ...
  productAuditLog,
};

export type ProductAuditLog = InferSelectModel<typeof productAuditLog>;
export type NewProductAuditLog = InferInsertModel<typeof productAuditLog>;
```

**Action**: Generate and run migration after this step

---

#### Step 3.1.3: Create CSV Service Interface Types

**File**: `apps/pim/src/types/csv.types.ts` (NEW)

```typescript
export interface ProductCsvRow {
  productCode?: string;
  name: string;
  alternativeName?: string;
  description?: string;
  brand?: string;
  material?: string;
  basePrice?: number;
  marketPrice?: number;
  supplyPrice?: number;
  status?: string;
  productType?: string;
  salesClassification?: string;
  purchaseClassification?: string;
  ageRestriction?: number;
  minQuantity?: number;
  maxQuantity?: number;
  seller?: string;
}

export interface CsvValidationError {
  row: number;
  errors: string[];
  data: ProductCsvRow;
}

export interface CsvImportResult {
  imported: number;
  failed: number;
  errors: CsvValidationError[];
  products?: any[];
}
```

---

#### Step 3.1.4: Create CSV Service

**File**: `apps/pim/src/services/product-csv.service.ts` (NEW)

```typescript
import { Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productMasters, productAuditLog } from '../schema';
import { ProductCsvRow, CsvValidationError, CsvImportResult } from '../types/csv.types';
import { InferInsertModel } from 'drizzle-orm';

type DbTx = Parameters<Parameters<typeof pimSchema extends infer S ? any : never>[0]>[0];

@Injectable()
export class ProductCsvService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * Parse CSV file content and return structured data
   */
  parseCsv(csvContent: string): Promise<ProductCsvRow[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => {
          // Normalize headers (remove spaces, convert to camelCase)
          return header.trim().replace(/\s+/g, '');
        },
        complete: (results) => {
          resolve(results.data as ProductCsvRow[]);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  }

  /**
   * Validate CSV data before import
   */
  validateCsvData(data: ProductCsvRow[]): {
    valid: ProductCsvRow[];
    invalid: CsvValidationError[];
  } {
    const valid: ProductCsvRow[] = [];
    const invalid: CsvValidationError[] = [];

    data.forEach((row, index) => {
      const errors: string[] = [];

      // Required field: name
      if (!row.name || row.name.trim() === '') {
        errors.push('Product name is required');
      }

      // Validate basePrice
      if (row.basePrice !== undefined && row.basePrice !== null) {
        const price = Number(row.basePrice);
        if (isNaN(price) || price < 0) {
          errors.push('Base price must be a non-negative number');
        }
      }

      // Validate marketPrice
      if (row.marketPrice !== undefined && row.marketPrice !== null) {
        const price = Number(row.marketPrice);
        if (isNaN(price) || price < 0) {
          errors.push('Market price must be a non-negative number');
        }
      }

      // Validate supplyPrice
      if (row.supplyPrice !== undefined && row.supplyPrice !== null) {
        const price = Number(row.supplyPrice);
        if (isNaN(price) || price < 0) {
          errors.push('Supply price must be a non-negative number');
        }
      }

      // Validate status
      if (row.status && !['active', 'inactive', 'draft'].includes(row.status)) {
        errors.push('Status must be one of: active, inactive, draft');
      }

      // Validate productType
      if (row.productType && !['regular_sale', 'limited_edition'].includes(row.productType)) {
        errors.push('Product type must be one of: regular_sale, limited_edition');
      }

      // Validate ageRestriction
      if (row.ageRestriction !== undefined && row.ageRestriction !== null) {
        const age = Number(row.ageRestriction);
        if (isNaN(age) || age < 0 || age > 100) {
          errors.push('Age restriction must be between 0 and 100');
        }
      }

      // Validate minQuantity
      if (row.minQuantity !== undefined && row.minQuantity !== null) {
        const qty = Number(row.minQuantity);
        if (isNaN(qty) || qty < 1) {
          errors.push('Minimum quantity must be at least 1');
        }
      }

      // Validate maxQuantity
      if (row.maxQuantity !== undefined && row.maxQuantity !== null) {
        const qty = Number(row.maxQuantity);
        if (isNaN(qty) || qty < 1) {
          errors.push('Maximum quantity must be at least 1');
        }
      }

      if (errors.length > 0) {
        invalid.push({ row: index + 2, errors, data: row }); // +2 for header and 1-based indexing
      } else {
        valid.push(row);
      }
    });

    return { valid, invalid };
  }

  /**
   * Import products from CSV data
   */
  async importProducts(csvData: ProductCsvRow[], userId: string): Promise<CsvImportResult> {
    const { valid, invalid } = this.validateCsvData(csvData);

    if (valid.length === 0) {
      return {
        imported: 0,
        failed: invalid.length,
        errors: invalid,
      };
    }

    // Transform CSV rows to database records
    const productsToInsert: InferInsertModel<typeof productMasters>[] = valid.map((row) => ({
      productCode: row.productCode || undefined,
      name: row.name.trim(),
      alternativeName: row.alternativeName?.trim() || undefined,
      description: row.description?.trim() || undefined,
      brand: row.brand?.trim() || undefined,
      material: row.material?.trim() || undefined,
      basePrice: row.basePrice ? Number(row.basePrice) : undefined,
      marketPrice: row.marketPrice ? Number(row.marketPrice) : undefined,
      supplyPrice: row.supplyPrice ? Number(row.supplyPrice) : undefined,
      status: (row.status as any) || 'draft',
      productType: (row.productType as any) || 'regular_sale',
      salesClassification: row.salesClassification?.trim() || undefined,
      purchaseClassification: row.purchaseClassification?.trim() || undefined,
      ageRestriction: row.ageRestriction ? Number(row.ageRestriction) : 0,
      minQuantity: row.minQuantity ? Number(row.minQuantity) : 1,
      maxQuantity: row.maxQuantity ? Number(row.maxQuantity) : undefined,
      seller: row.seller?.trim() || undefined,
      approvalStatus: 'draft',
      createdBy: userId,
      updatedBy: userId,
    }));

    // Batch insert with audit logging
    const inserted = await this.db.transaction(async (tx) => {
      const products = await tx
        .insert(productMasters)
        .values(productsToInsert)
        .returning();

      // Log audit entries for all imported products
      const auditEntries = products.map((product) => ({
        productId: product.id,
        action: 'imported',
        changes: { source: 'csv_import', productCode: product.productCode },
        userId,
        userEmail: 'unknown', // Will be populated by interceptor in real scenario
      }));

      await tx.insert(productAuditLog).values(auditEntries);

      return products;
    });

    return {
      imported: inserted.length,
      failed: invalid.length,
      errors: invalid,
      products: inserted,
    };
  }

  /**
   * Export products to CSV format
   */
  async exportProducts(productIds?: string[]): Promise<string> {
    let products;

    if (productIds && productIds.length > 0) {
      const { inArray } = await import('drizzle-orm');
      products = await this.db
        .select()
        .from(productMasters)
        .where(inArray(productMasters.id, productIds));
    } else {
      const { isNull } = await import('drizzle-orm');
      products = await this.db
        .select()
        .from(productMasters)
        .where(isNull(productMasters.deletedAt));
    }

    // Transform to CSV-friendly format
    const csvData = products.map((product) => ({
      productCode: product.productCode || '',
      name: product.name,
      alternativeName: product.alternativeName || '',
      description: product.description || '',
      brand: product.brand || '',
      material: product.material || '',
      basePrice: product.basePrice || 0,
      marketPrice: product.marketPrice || 0,
      supplyPrice: product.supplyPrice || 0,
      status: product.status || 'draft',
      productType: product.productType || 'regular_sale',
      salesClassification: product.salesClassification || '',
      purchaseClassification: product.purchaseClassification || '',
      ageRestriction: product.ageRestriction || 0,
      minQuantity: product.minQuantity || 1,
      maxQuantity: product.maxQuantity || '',
      seller: product.seller || '',
      createdAt: product.createdAt?.toISOString() || '',
    }));

    // Generate CSV string
    const csv = Papa.unparse(csvData);
    return csv;
  }

  /**
   * Generate CSV template for bulk import
   */
  generateTemplate(): string {
    const template = [
      {
        productCode: 'PROD001',
        name: 'Example Product',
        alternativeName: 'Alt Name',
        description: 'Product description here',
        brand: 'Brand Name',
        material: 'Cotton 100%',
        basePrice: '10000',
        marketPrice: '15000',
        supplyPrice: '8000',
        status: 'active',
        productType: 'regular_sale',
        salesClassification: 'Beauty',
        purchaseClassification: 'Retail',
        ageRestriction: '0',
        minQuantity: '1',
        maxQuantity: '100',
        seller: 'Seller Name',
      },
    ];

    return Papa.unparse(template);
  }
}
```

---

#### Step 3.1.5: Create CSV Controller

**File**: `apps/pim/src/controllers/product-csv.controller.ts` (NEW)

```typescript
import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductCsvService } from '../services/product-csv.service';

@Controller('api/pim/products')
export class ProductCsvController {
  constructor(private readonly csvService: ProductCsvService) {}

  @Get('csv/template')
  async downloadTemplate(@Res() res: Response) {
    const csv = this.csvService.generateTemplate();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.csv');
    res.send(csv);
  }

  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const csvContent = file.buffer.toString('utf-8');
    const csvData = await this.csvService.parseCsv(csvContent);

    return this.csvService.importProducts(csvData, userId);
  }

  @Get('export')
  async exportProducts(
    @Query('productIds') productIds: string,
    @Res() res: Response,
  ) {
    const ids = productIds ? productIds.split(',').filter(Boolean) : undefined;
    const csv = await this.csvService.exportProducts(ids);

    const filename = `products-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  }
}
```

---

#### Step 3.1.6: Register Services and Controllers

**File**: `apps/pim/src/pim.module.ts`

Add to module:

```typescript
import { ProductCsvService } from './services/product-csv.service';
import { ProductCsvController } from './controllers/product-csv.controller';

@Module({
  // ... existing imports ...
  controllers: [
    // ... existing controllers ...
    ProductCsvController,
  ],
  providers: [
    // ... existing providers ...
    ProductCsvService,
  ],
})
export class PimModule {}
```

---

## Feature 3.2: Product Audit Logging

### Goals
- Automatically log all product mutations (create, update, delete)
- Capture user context (userId, IP, user agent)
- Store field-level changes for audit trails
- Provide audit history query endpoints

### Implementation Steps

#### Step 3.2.1: Create Audit Log Interceptor

**File**: `apps/pim/src/interceptors/audit-log.interceptor.ts` (NEW)

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productAuditLog } from '../schema';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, ip, headers } = request;

    // Only log mutations (POST, PUT, PATCH, DELETE)
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip audit log for certain endpoints
    if (url.includes('/bulk-import') || url.includes('/export')) {
      return next.handle();
    }

    const userId = body.userId || headers['x-user-id'] || 'system';
    const userEmail = headers['x-user-email'] || 'unknown';
    const productId = request.params.id || body.productId;

    return next.handle().pipe(
      tap(async (response) => {
        if (productId && userId) {
          try {
            await this.db.insert(productAuditLog).values({
              productId,
              action: this.mapMethodToAction(method, url),
              changes: this.sanitizeChanges(body),
              userId,
              userEmail,
              ipAddress: ip,
              userAgent: headers['user-agent'] || 'unknown',
            });
          } catch (error) {
            // Log error but don't fail the request
            console.error('Failed to log audit entry:', error);
          }
        }
      }),
    );
  }

  private mapMethodToAction(method: string, url: string): string {
    if (url.includes('/restore')) return 'restored';
    if (url.includes('/approve')) return 'approved';
    if (url.includes('/reject')) return 'rejected';

    const actionMap: Record<string, string> = {
      POST: 'created',
      PUT: 'updated',
      PATCH: 'updated',
      DELETE: 'deleted',
    };
    return actionMap[method] || 'unknown';
  }

  private sanitizeChanges(body: any): Record<string, any> {
    // Remove sensitive or unnecessary fields
    const { userId, password, token, ...changes } = body;
    return changes;
  }
}
```

---

#### Step 3.2.2: Create Audit Service

**File**: `apps/pim/src/services/product-audit.service.ts` (NEW)

```typescript
import { Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productAuditLog, NewProductAuditLog } from '../schema';

@Injectable()
export class ProductAuditService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * Get audit history for a specific product
   */
  async getProductAuditHistory(productId: string) {
    return this.db
      .select()
      .from(productAuditLog)
      .where(eq(productAuditLog.productId, productId))
      .orderBy(desc(productAuditLog.timestamp));
  }

  /**
   * Get recent audit logs (all products)
   */
  async getRecentAuditLogs(limit = 100) {
    return this.db
      .select()
      .from(productAuditLog)
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }

  /**
   * Get audit logs by user
   */
  async getAuditLogsByUser(userId: string, limit = 100) {
    return this.db
      .select()
      .from(productAuditLog)
      .where(eq(productAuditLog.userId, userId))
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }

  /**
   * Get audit logs by action type
   */
  async getAuditLogsByAction(action: string, limit = 100) {
    return this.db
      .select()
      .from(productAuditLog)
      .where(eq(productAuditLog.action, action))
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }

  /**
   * Manually log an audit entry
   */
  async logAuditEntry(entry: NewProductAuditLog) {
    const [logged] = await this.db
      .insert(productAuditLog)
      .values(entry)
      .returning();
    return logged;
  }
}
```

---

#### Step 3.2.3: Create Audit Controller

**File**: `apps/pim/src/controllers/product-audit.controller.ts` (NEW)

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductAuditService } from '../services/product-audit.service';

@Controller('api/pim/audit')
export class ProductAuditController {
  constructor(private readonly auditService: ProductAuditService) {}

  @Get('products/:id')
  async getProductAuditHistory(@Param('id') productId: string) {
    return this.auditService.getProductAuditHistory(productId);
  }

  @Get('recent')
  async getRecentAuditLogs(@Query('limit') limit?: string) {
    return this.auditService.getRecentAuditLogs(
      limit ? parseInt(limit) : 100,
    );
  }

  @Get('by-user/:userId')
  async getAuditLogsByUser(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getAuditLogsByUser(
      userId,
      limit ? parseInt(limit) : 100,
    );
  }

  @Get('by-action/:action')
  async getAuditLogsByAction(
    @Param('action') action: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getAuditLogsByAction(
      action,
      limit ? parseInt(limit) : 100,
    );
  }
}
```

---

#### Step 3.2.4: Register Audit Services and Apply Interceptor

**File**: `apps/pim/src/pim.module.ts`

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { ProductAuditService } from './services/product-audit.service';
import { ProductAuditController } from './controllers/product-audit.controller';

@Module({
  // ... existing imports ...
  controllers: [
    // ... existing controllers ...
    ProductAuditController,
  ],
  providers: [
    // ... existing providers ...
    ProductAuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class PimModule {}
```

---

## Testing Plan

### 3.1 CSV Import/Export Testing

#### Test 3.1.1: Download CSV Template

```bash
curl -X GET http://localhost:3001/api/pim/products/csv/template \
  -o template.csv
```

**Expected**: Download `template.csv` with sample data

---

#### Test 3.1.2: Import Valid CSV

Create `test-products.csv`:
```csv
productCode,name,description,brand,basePrice,status,productType
TEST001,Test Product 1,Description 1,Brand A,10000,active,regular_sale
TEST002,Test Product 2,Description 2,Brand B,15000,draft,limited_edition
```

```bash
curl -X POST http://localhost:3001/api/pim/products/bulk-import \
  -F "file=@test-products.csv" \
  -F "userId=test-user-123"
```

**Expected**: JSON response with `{ imported: 2, failed: 0 }`

---

#### Test 3.1.3: Import Invalid CSV

Create `invalid-products.csv`:
```csv
productCode,name,basePrice
TEST003,,invalid-price
TEST004,Valid Product,-100
```

```bash
curl -X POST http://localhost:3001/api/pim/products/bulk-import \
  -F "file=@invalid-products.csv" \
  -F "userId=test-user-123"
```

**Expected**: JSON with validation errors for each invalid row

---

#### Test 3.1.4: Export Products

```bash
curl -X GET "http://localhost:3001/api/pim/products/export" \
  -o exported-products.csv
```

**Expected**: Download CSV with all products

```bash
# Export specific products
curl -X GET "http://localhost:3001/api/pim/products/export?productIds=id1,id2,id3" \
  -o selected-products.csv
```

---

### 3.2 Audit Logging Testing

#### Test 3.2.1: Verify Audit Log on Product Creation

```bash
# Create a product
curl -X POST http://localhost:3001/api/pim/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Audit Test Product",
    "basePrice": 5000,
    "userId": "audit-user-123"
  }'
```

Verify audit log entry was created:

```bash
curl -X GET http://localhost:3001/api/pim/audit/recent?limit=1
```

**Expected**: Audit entry with action='created'

---

#### Test 3.2.2: Get Product Audit History

```bash
curl -X GET http://localhost:3001/api/pim/audit/products/{productId}
```

**Expected**: Array of audit entries for that product

---

#### Test 3.2.3: Get Audit Logs by User

```bash
curl -X GET http://localhost:3001/api/pim/audit/by-user/test-user-123
```

**Expected**: All audit entries for that user

---

#### Test 3.2.4: Get Audit Logs by Action

```bash
curl -X GET http://localhost:3001/api/pim/audit/by-action/created
```

**Expected**: All 'created' action audit entries

---

## Integration Testing

### Create E2E Test Suite

**File**: `apps/pim/test/phase3-features.e2e-spec.ts` (NEW)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PimModule } from '../src/pim.module';

describe('Phase 3 Features (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PimModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CSV Import/Export', () => {
    it('should download CSV template', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/pim/products/csv/template')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toContain('productCode');
    });

    it('should import valid CSV', async () => {
      const csvContent = 
        'productCode,name,basePrice\n' +
        'TEST001,Test Product,10000';

      const response = await request(app.getHttpServer())
        .post('/api/pim/products/bulk-import')
        .field('userId', 'test-user')
        .attach('file', Buffer.from(csvContent), 'test.csv')
        .expect(201);

      expect(response.body.imported).toBeGreaterThan(0);
    });

    it('should export products to CSV', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/pim/products/export')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
    });
  });

  describe('Audit Logging', () => {
    let productId: string;

    it('should log product creation', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/pim/products')
        .send({
          name: 'Audit Test',
          basePrice: 5000,
          userId: 'test-user',
        })
        .expect(201);

      productId = createResponse.body.id;

      const auditResponse = await request(app.getHttpServer())
        .get(`/api/pim/audit/products/${productId}`)
        .expect(200);

      expect(auditResponse.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'created',
            productId,
          }),
        ]),
      );
    });

    it('should get recent audit logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/pim/audit/recent?limit=10')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
```

---

## Verification Checklist

### CSV Features
- [ ] CSV template downloads successfully
- [ ] Valid CSV imports without errors
- [ ] Invalid CSV shows validation errors
- [ ] Products export to CSV correctly
- [ ] Exported CSV can be re-imported
- [ ] Large CSV files (100+ rows) import successfully
- [ ] UTF-8 characters handled correctly

### Audit Features
- [ ] Product creation logged
- [ ] Product updates logged
- [ ] Product deletion logged
- [ ] User context captured (userId, IP, user-agent)
- [ ] Field-level changes stored
- [ ] Audit history queryable by product
- [ ] Audit logs queryable by user
- [ ] Audit logs queryable by action type

### Performance
- [ ] CSV import handles 1000+ rows in reasonable time (<30s)
- [ ] Audit logging doesn't slow down mutations
- [ ] Export queries don't timeout on large datasets

---

## Troubleshooting

### Issue: CSV Import Fails with "No file uploaded"

**Solution**: Ensure:
1. `Content-Type: multipart/form-data` header
2. File field name is `file`
3. Multer properly configured in NestJS

---

### Issue: Audit Logs Not Created

**Solution**: Check:
1. `AuditLogInterceptor` registered globally
2. `productAuditLog` table exists (run migration)
3. No errors in console logs
4. Request has `userId` in body or headers

---

### Issue: CSV Export Times Out

**Solution**:
1. Add pagination to export (chunks of 1000)
2. Consider background job for large exports
3. Add streaming response for large datasets

---

## Next Steps After Phase 3

1. **Proceed to Phase 4**: Dashboard Metrics (Week 5)
2. **Performance Optimization**: Add caching for frequent queries
3. **Background Jobs**: Use Bull/BullMQ for async CSV processing
4. **Frontend Integration**: Build UI components for CSV upload/download
5. **Authentication**: Add JWT auth to all endpoints

---

## Success Criteria

Phase 3 is complete when:
- ✅ All CSV endpoints functional
- ✅ CSV validation working correctly
- ✅ Audit logging captures all mutations
- ✅ All tests passing
- ✅ No TypeScript errors
- ✅ API documentation updated

