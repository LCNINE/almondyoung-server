# Step 9: Advanced Inventory Search - Test Cases

**Date:** 2025-10-27
**Feature:** Advanced inventory search with comprehensive filtering
**Endpoint:** `GET /wms/inventory/skus/search/advanced`

---

## Test Environment Setup

```bash
# Start the WMS service
npm run start:dev wms

# Base URL
BASE_URL="http://localhost:3000"
ENDPOINT="/wms/inventory/skus/search/advanced"
```

---

## Test Cases

### 1. Basic Search Tests

#### 1.1 Search by name
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?search=lash" | jq
```

**Expected Result:**
- Returns SKUs with "lash" in name or code
- Paginated response with `items`, `total`, `limit`, `offset`

#### 1.2 Search by barcode
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?barcode=8801234567890" | jq
```

**Expected Result:**
- Returns SKU with exact barcode match
- Empty array if no match

---

### 2. Stock Display Mode Tests

#### 2.1 All items (default)
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?displayMode=all&limit=10" | jq
```

**Expected Result:**
- Returns all SKUs regardless of stock level

#### 2.2 Below safety stock
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?displayMode=below_safety&limit=10" | jq
```

**Expected Result:**
- Returns only SKUs where `onHand < safetyStock`

#### 2.3 With stock
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?displayMode=with_stock&limit=10" | jq
```

**Expected Result:**
- Returns only SKUs where `onHand > 0`

#### 2.4 Out of stock
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?displayMode=out_of_stock&limit=10" | jq
```

**Expected Result:**
- Returns only SKUs where `onHand = 0`

---

### 3. WMS-Internal Grouping Tests

#### 3.1 Filter by group ID
```bash
# First, get a group ID
GROUP_ID=$(curl -s -X GET "${BASE_URL}/wms/inventory/sku-groups" | jq -r '.items[0].id')

# Search by group ID
curl -X GET "${BASE_URL}${ENDPOINT}?groupId=${GROUP_ID}" | jq
```

**Expected Result:**
- Returns only SKUs belonging to the specified group
- All items have matching `groupId`

#### 3.2 Filter by group code
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?groupCode=LASH-GROUP-001" | jq
```

**Expected Result:**
- Returns SKUs in group with code "LASH-GROUP-001"
- Empty array if group code doesn't exist

#### 3.3 Filter grouped SKUs
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?isGrouped=true&limit=10" | jq
```

**Expected Result:**
- Returns only SKUs that have a `groupId` (not null)

#### 3.4 Filter ungrouped SKUs (standalone)
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?isGrouped=false&limit=10" | jq
```

**Expected Result:**
- Returns only SKUs with `groupId = null`
- These are standalone SKUs not in any group

#### 3.5 Filter by inventory master ID
```bash
# First, get a master ID
MASTER_ID=$(curl -s -X GET "${BASE_URL}/wms/inventory/skus" | jq -r '.[0].masterId')

# Search by master ID
curl -X GET "${BASE_URL}${ENDPOINT}?inventoryMasterId=${MASTER_ID}" | jq
```

**Expected Result:**
- Returns all SKUs belonging to the specified WMS inventory master

---

### 4. Location & Warehouse Tests

#### 4.1 Filter by location
```bash
LOCATION_ID="<uuid-of-location>"
curl -X GET "${BASE_URL}${ENDPOINT}?locationId=${LOCATION_ID}" | jq
```

**Expected Result:**
- Returns SKUs with `primaryLocationId = LOCATION_ID`

#### 4.2 Filter by warehouse
```bash
WAREHOUSE_ID="<uuid-of-warehouse>"
curl -X GET "${BASE_URL}${ENDPOINT}?warehouseId=${WAREHOUSE_ID}" | jq
```

**Expected Result:**
- Returns SKUs with stock in the specified warehouse

---

### 5. Date Range Tests

#### 5.1 Filter by start date
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?startDate=2025-01-01&limit=10" | jq
```

**Expected Result:**
- Returns SKUs created on or after 2025-01-01

#### 5.2 Filter by date range
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?startDate=2025-01-01&endDate=2025-12-31&limit=10" | jq
```

**Expected Result:**
- Returns SKUs created between 2025-01-01 and 2025-12-31

---

### 6. Sorting Tests

#### 6.1 Sort by name ascending
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?sortBy=name&sortOrder=asc&limit=10" | jq
```

**Expected Result:**
- Results sorted alphabetically by name (A-Z)

#### 6.2 Sort by created date descending
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?sortBy=createdAt&sortOrder=desc&limit=10" | jq
```

**Expected Result:**
- Results sorted by creation date (newest first)

#### 6.3 Sort by safety stock
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?sortBy=safetyStock&sortOrder=desc&limit=10" | jq
```

**Expected Result:**
- Results sorted by safety stock level (highest first)

---

### 7. Pagination Tests

#### 7.1 First page
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?limit=10&offset=0" | jq
```

**Expected Result:**
- Returns first 10 items
- `limit: 10, offset: 0`

#### 7.2 Second page
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?limit=10&offset=10" | jq
```

**Expected Result:**
- Returns next 10 items
- `limit: 10, offset: 10`

#### 7.3 Large page size
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?limit=100&offset=0" | jq
```

**Expected Result:**
- Returns up to 100 items

---

### 8. Combined Filter Tests

#### 8.1 Search + Display Mode + Grouped
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?search=lash&displayMode=below_safety&isGrouped=true&limit=20" | jq
```

**Expected Result:**
- Returns grouped SKUs with "lash" in name/code
- That are below safety stock level
- Limited to 20 results

#### 8.2 Group + Sort + Pagination
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?groupCode=LASH-GROUP-001&sortBy=name&sortOrder=asc&limit=10&offset=0" | jq
```

**Expected Result:**
- Returns SKUs in group "LASH-GROUP-001"
- Sorted alphabetically by name
- First 10 results

#### 8.3 Date Range + Stock Type + Location
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?startDate=2025-01-01&stockType=physical&locationId=${LOCATION_ID}&limit=25" | jq
```

**Expected Result:**
- Returns physical stock type SKUs
- Created after 2025-01-01
- In specified location
- Limited to 25 results

---

### 9. Edge Cases

#### 9.1 No filters (default)
```bash
curl -X GET "${BASE_URL}${ENDPOINT}" | jq
```

**Expected Result:**
- Returns all SKUs with default pagination (50 items, offset 0)
- Sorted by createdAt desc (default)

#### 9.2 Non-existent group code
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?groupCode=NON-EXISTENT" | jq
```

**Expected Result:**
```json
{
  "items": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

#### 9.3 Invalid date format
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?startDate=invalid-date" | jq
```

**Expected Result:**
- 400 Bad Request with validation error

#### 9.4 isGrouped with specific groupId (redundant but valid)
```bash
curl -X GET "${BASE_URL}${ENDPOINT}?isGrouped=true&groupId=${GROUP_ID}" | jq
```

**Expected Result:**
- Should work correctly (both filters applied)
- Returns SKUs in the specified group

---

### 10. Performance Tests

#### 10.1 Large result set
```bash
time curl -X GET "${BASE_URL}${ENDPOINT}?limit=200&offset=0" | jq -r '.total'
```

**Expected Result:**
- Should complete in < 2 seconds
- Check query performance with EXPLAIN if slow

#### 10.2 Complex combined filters
```bash
time curl -X GET "${BASE_URL}${ENDPOINT}?search=lash&displayMode=with_stock&isGrouped=true&sortBy=name&sortOrder=asc&limit=50" | jq -r '.total'
```

**Expected Result:**
- Should complete in < 3 seconds
- All filters applied correctly

---

## Response Format Validation

All successful responses should match this structure:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "string",
      "code": "string",
      "defaultBarcode": "string",
      "safetyStock": 0,
      "masterId": "uuid",
      "master": {
        "id": "uuid",
        "name": "string",
        "code": "string",
        "hasOptions": false
      },
      "barcodes": [],
      "supplierNames": [],
      "categoryNames": [],
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

---

## Swagger Documentation Verification

1. Navigate to: `http://localhost:3000/api-docs`
2. Find: `GET /wms/inventory/skus/search/advanced`
3. Verify all query parameters are documented:
   - `search` (string)
   - `displayMode` (enum: all, below_safety, with_stock, out_of_stock)
   - `supplierId` (string)
   - `warehouseId` (string)
   - `locationId` (string)
   - `startDate` (date-string)
   - `endDate` (date-string)
   - `stockType` (string)
   - `barcode` (string)
   - `groupId` (uuid)
   - `groupCode` (string)
   - `isGrouped` (boolean)
   - `inventoryMasterId` (uuid)
   - `limit` (number, default: 50, max: 200)
   - `offset` (number, default: 0)
   - `sortBy` (enum: name, code, createdAt, updatedAt, safetyStock)
   - `sortOrder` (enum: asc, desc)

4. Test using "Try it out" button in Swagger UI

---

## Test Results Checklist

- [ ] All basic search tests pass
- [ ] All stock display mode filters work correctly
- [ ] Group filters (groupId, groupCode, isGrouped) work correctly
- [ ] Inventory master filter works
- [ ] Location and warehouse filters work
- [ ] Date range filtering works
- [ ] All sort options work correctly
- [ ] Pagination works correctly
- [ ] Combined filters work together
- [ ] Edge cases handled properly
- [ ] Performance is acceptable (< 3s for complex queries)
- [ ] Response format matches specification
- [ ] Swagger documentation is complete and accurate
- [ ] No console errors or warnings
- [ ] No database query errors in logs

---

## Known Limitations

1. **Group Code Lookup**: Requires extra query to resolve code to ID
2. **Stock Display Modes**: Only work when stock_summary table is populated
3. **Warehouse Filter**: Requires stock_summary records
4. **Performance**: Complex filters with large datasets may require query optimization

---

## Success Criteria

✅ **Functional Requirements:**
- All 15+ filter parameters work correctly
- Filters can be combined without conflicts
- Pagination works with all filter combinations
- Sorting works with all filter combinations
- Clean domain separation (no PIM concept leakage)

✅ **Non-Functional Requirements:**
- Response time < 3 seconds for complex queries
- Response time < 1 second for simple queries
- Proper error handling for invalid inputs
- Complete Swagger documentation
- No linting errors
- Type-safe implementation

✅ **Architecture Requirements:**
- Uses WMS-internal grouping (not PIM hierarchy)
- No foreign keys to PIM service
- Proper transaction handling with `inTx()` pattern
- Follows established service patterns

