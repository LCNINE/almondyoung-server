import { asc, desc } from 'drizzle-orm';
import { productMasters, productMasterVersions } from '../../../schema/catalog.schema';
import { resolveMasterSort } from './product-masters-sort.util';

describe('resolveMasterSort', () => {
  it("defaults to product_masters.createdAt DESC (matches the '등록일' column)", () => {
    const { column, direction } = resolveMasterSort(undefined, undefined);
    expect(column).toBe(productMasters.createdAt);
    expect(direction).toBe(desc);
  });

  it('maps name/updatedAt to version columns', () => {
    expect(resolveMasterSort('name', 'asc').column).toBe(productMasterVersions.name);
    expect(resolveMasterSort('updatedAt', 'desc').column).toBe(productMasterVersions.updatedAt);
  });

  it('maps order asc/desc to the drizzle direction fn', () => {
    expect(resolveMasterSort('createdAt', 'asc').direction).toBe(asc);
    expect(resolveMasterSort('createdAt', 'desc').direction).toBe(desc);
  });

  it('falls back to createdAt column for unknown sort keys', () => {
    expect(resolveMasterSort('bogus', 'asc').column).toBe(productMasters.createdAt);
  });
});
