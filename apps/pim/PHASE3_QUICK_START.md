# Phase 3 Quick Start Guide

**⚡ Fast-track implementation of CSV Import/Export and Audit Logging**

---

## Prerequisites

✅ Phase 2 completed  
✅ Database running  
✅ PIM service running on port 3001

---

## Quick Implementation Steps

### 1️⃣ Install Dependencies (2 min)

```bash
npm install papaparse @nestjs/platform-express multer
npm install --save-dev @types/papaparse @types/multer
```

---

### 2️⃣ Add Audit Table to Schema (5 min)

**File**: `apps/pim/src/schema.ts`

Add after existing tables:

```typescript
export const productAuditLog = pgTable(
  'product_audit_log',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    productId: uuid('product_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    changes: jsonb('changes').$type<Record<string, any>>(),
    userId: uuid('user_id').notNull(),
    userEmail: varchar('user_email', { length: 255 }),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    ipAddress: varchar('ip_address', { length: 45 }),
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

Update exports:

```typescript
export const pimSchema = {
  // ... existing tables ...
  productAuditLog,
};

export type ProductAuditLog = InferSelectModel<typeof productAuditLog>;
export type NewProductAuditLog = InferInsertModel<typeof productAuditLog>;
```

**🔴 Run migration now** (you said you'll handle this)

---

### 3️⃣ Create CSV Types (2 min)

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

### 4️⃣ Copy Service Files (10 min)

Create these 3 service files from PHASE3_IMPLEMENTATION_PLAN.md:

1. **`apps/pim/src/services/product-csv.service.ts`** - Full implementation in plan
2. **`apps/pim/src/services/product-audit.service.ts`** - Full implementation in plan
3. **`apps/pim/src/interceptors/audit-log.interceptor.ts`** - Full implementation in plan

---

### 5️⃣ Copy Controller Files (5 min)

Create these 2 controller files from PHASE3_IMPLEMENTATION_PLAN.md:

1. **`apps/pim/src/controllers/product-csv.controller.ts`** - Full implementation in plan
2. **`apps/pim/src/controllers/product-audit.controller.ts`** - Full implementation in plan

---

### 6️⃣ Register in Module (3 min)

**File**: `apps/pim/src/pim.module.ts`

Add imports:

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ProductCsvService } from './services/product-csv.service';
import { ProductCsvController } from './controllers/product-csv.controller';
import { ProductAuditService } from './services/product-audit.service';
import { ProductAuditController } from './controllers/product-audit.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
```

Update module:

```typescript
@Module({
  controllers: [
    // ... existing ...
    ProductCsvController,
    ProductAuditController,
  ],
  providers: [
    // ... existing ...
    ProductCsvService,
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

### 7️⃣ Test CSV Features (5 min)

```bash
# Download template
curl http://localhost:3001/api/pim/products/csv/template -o template.csv

# Create test CSV
echo "productCode,name,basePrice
TEST001,Test Product,10000" > test.csv

# Import
curl -X POST http://localhost:3001/api/pim/products/bulk-import \
  -F "file=@test.csv" \
  -F "userId=test-user-123"

# Export
curl http://localhost:3001/api/pim/products/export -o export.csv
```

---

### 8️⃣ Test Audit Logging (3 min)

```bash
# Create product (triggers audit log)
curl -X POST http://localhost:3001/api/pim/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Audit Test","basePrice":5000,"userId":"user123"}'

# Check recent audit logs
curl http://localhost:3001/api/pim/audit/recent?limit=10
```

---

## File Checklist

### New Files to Create
- [ ] `apps/pim/src/types/csv.types.ts`
- [ ] `apps/pim/src/services/product-csv.service.ts`
- [ ] `apps/pim/src/services/product-audit.service.ts`
- [ ] `apps/pim/src/controllers/product-csv.controller.ts`
- [ ] `apps/pim/src/controllers/product-audit.controller.ts`
- [ ] `apps/pim/src/interceptors/audit-log.interceptor.ts`

### Files to Modify
- [ ] `apps/pim/src/schema.ts` - Add productAuditLog table
- [ ] `apps/pim/src/pim.module.ts` - Register new services/controllers

---

## Quick Test Commands

```bash
# 1. Template download
curl http://localhost:3001/api/pim/products/csv/template -o template.csv

# 2. Import CSV
curl -X POST http://localhost:3001/api/pim/products/bulk-import \
  -F "file=@template.csv" -F "userId=admin"

# 3. Export CSV
curl http://localhost:3001/api/pim/products/export -o products.csv

# 4. Check audit logs
curl http://localhost:3001/api/pim/audit/recent
```

---

## Troubleshooting

**CSV upload fails**: Ensure `Content-Type: multipart/form-data`

**Audit logs empty**: Check interceptor is registered globally

**TypeScript errors**: Run `npm run build` to see detailed errors

---

## Success Criteria

✅ CSV template downloads  
✅ CSV import works with valid data  
✅ CSV export generates file  
✅ Audit logs capture product mutations  
✅ No TypeScript errors  
✅ All endpoints return 200/201

---

**⏱️ Total Time: ~35 minutes**

Ready to proceed to Phase 4 (Dashboard Metrics)!

