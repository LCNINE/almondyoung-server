import { getTableConfig } from 'drizzle-orm/pg-core';
import { productMasterVersions } from './catalog.schema';

describe('productMasterVersions schema', () => {
  it('enforces productCode uniqueness only for active versions', () => {
    const config = getTableConfig(productMasterVersions);
    const productCodeColumn = config.columns.find((column) => column.name === 'product_code');
    const productCodeIndex = config.indexes.find((index) => index.config.name === 'unique_active_product_code');

    expect(productCodeColumn?.isUnique).toBe(false);
    expect(productCodeIndex?.config.unique).toBe(true);
    expect(productCodeIndex?.config.where).toBeDefined();
    expect(productCodeIndex?.config.columns).toHaveLength(1);
    expect(productCodeIndex?.config.columns[0]).toMatchObject({ name: 'product_code' });
  });
});
