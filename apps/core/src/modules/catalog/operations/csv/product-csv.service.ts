import { Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productMasters, productMasterVersions, productAuditLog } from '../../schema/catalog.schema';
import { ProductCsvRow, CsvValidationError, CsvImportResult } from './dto';
import { NewProductMaster, NewProductMasterVersion } from '../../catalog.types';
import { inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

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

      if (row.fulfillmentKind && !['physical', 'digital'].includes(row.fulfillmentKind)) {
        errors.push('Fulfillment kind must be one of: physical, digital');
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

    // Batch insert with audit logging
    const inserted = await this.db.transaction(async (tx) => {
      const products: NewProductMasterVersion[] = [];

      for (const row of valid) {
        const masterId = uuidv7();
        const versionId = uuidv7();

        // 1. Create master metadata
        await tx.insert(productMasters).values({
          id: masterId,
          createdBy: userId,
        });

        // 2. Create first version
        const [version] = await tx
          .insert(productMasterVersions)
          .values({
            id: versionId,
            masterId: masterId,
            version: 1,
            status: 'draft',
            parentVersionId: null,
            draftOwnerId: null,
            productCode: row.productCode || undefined,
            name: row.name.trim(),
            alternativeName: row.alternativeName?.trim() || undefined,
            description: row.description?.trim() || undefined,
            brand: row.brand?.trim() || undefined,
            material: row.material?.trim() || undefined,
            marketPrice: row.marketPrice ? Number(row.marketPrice) : undefined,
            supplyPrice: row.supplyPrice ? Number(row.supplyPrice) : undefined,
            productType: (row.productType as any) || 'regular_sale',
            fulfillmentKind: (row.fulfillmentKind as 'physical' | 'digital') || 'physical',
            salesClassification: row.salesClassification?.trim() || undefined,
            purchaseClassification: row.purchaseClassification?.trim() || undefined,
            ageRestriction: row.ageRestriction ? Number(row.ageRestriction) : 0,
            minQuantity: row.minQuantity ? Number(row.minQuantity) : 1,
            maxQuantity: row.maxQuantity ? Number(row.maxQuantity) : undefined,
            seller: row.seller?.trim() || undefined,
            approvalStatus: 'draft',
            createdBy: userId,
            updatedBy: userId,
          })
          .returning();

        products.push(version);
      }

      // Log audit entries for all imported products
      const auditEntries = products.map((product) => ({
        versionId: product.id!,
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
      products = await this.db.select().from(productMasters).where(inArray(productMasters.id, productIds));
    } else {
      products = await this.db.select().from(productMasters).where(isNull(productMasters.deletedAt));
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
      fulfillmentKind: (product.fulfillmentKind as 'physical' | 'digital') || 'physical',
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
        fulfillmentKind: 'physical',
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
