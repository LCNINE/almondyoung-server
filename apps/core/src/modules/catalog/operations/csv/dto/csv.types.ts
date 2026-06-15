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
  fulfillmentKind?: 'physical' | 'digital';
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
