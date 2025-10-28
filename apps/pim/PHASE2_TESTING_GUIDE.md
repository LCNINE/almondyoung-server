# Phase 2 Testing Guide - Category Enhancement

## Overview
This guide provides step-by-step instructions for testing the Phase 2 category enhancement features.

## Prerequisites

1. **Database Migration**: Run the migration to add new fields to `product_categories` table:
   ```bash
   npm run db:generate:pim
   npm run db:migrate:pim
   ```

2. **Start PIM Service**:
   ```bash
   npm run start:dev pim
   ```

3. **Verify Service is Running**: Check that the service is running on the configured port (default: 3001)

## Test Cases

### 1. Update Display Settings

**Endpoint**: `PATCH /api/pim/categories/:id/display-settings`

**Test Case 1.1**: Update basic display settings
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/display-settings \
  -H "Content-Type: application/json" \
  -d '{
    "showOnMainCategory": true,
    "pcAndMobile": true,
    "mobileOnly": false,
    "productDisplayOrder": "asc",
    "defaultSortField": "name"
  }'
```

**Expected Response**: 200 OK with updated category object

**Test Case 1.2**: Update menu positions
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/display-settings \
  -H "Content-Type: application/json" \
  -d '{
    "menuPositions": {
      "leftSide": true,
      "topMenu": true,
      "footerMenu": false
    }
  }'
```

**Expected Response**: 200 OK with updated category object

**Test Case 1.3**: Invalid category ID
```bash
curl -X PATCH http://localhost:3001/categories/invalid-uuid/display-settings \
  -H "Content-Type: application/json" \
  -d '{
    "showOnMainCategory": true
  }'
```

**Expected Response**: 404 Not Found

---

### 2. Update SEO Configuration

**Endpoint**: `PATCH /api/pim/categories/:id/seo`

**Test Case 2.1**: Update SEO meta information
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/seo \
  -H "Content-Type: application/json" \
  -d '{
    "browserTitle": "뷰티 제품 - 알몬드영",
    "metaAuthor": "AlmondYoung",
    "metaDescription": "최고급 뷰티 제품을 합리적인 가격에 만나보세요",
    "metaKeywords": ["뷰티", "화장품", "스킨케어", "메이크업"],
    "showInSearchEngines": true
  }'
```

**Expected Response**: 200 OK with updated category object

**Test Case 2.2**: Update partial SEO config
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/seo \
  -H "Content-Type: application/json" \
  -d '{
    "browserTitle": "새로운 타이틀",
    "showInSearchEngines": false
  }'
```

**Expected Response**: 200 OK with merged SEO configuration

**Test Case 2.3**: Empty keywords array
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/seo \
  -H "Content-Type: application/json" \
  -d '{
    "metaKeywords": []
  }'
```

**Expected Response**: 200 OK

---

### 3. Update Template Configuration

**Endpoint**: `PATCH /api/pim/categories/:id/template`

**Test Case 3.1**: Set default template
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/template \
  -H "Content-Type: application/json" \
  -d '{
    "templateType": "default"
  }'
```

**Expected Response**: 200 OK

**Test Case 3.2**: Set custom template with HTML and CSS
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/template \
  -H "Content-Type: application/json" \
  -d '{
    "templateType": "custom",
    "htmlContent": "<div class=\"custom-category\"><h1>특별 카테고리</h1><p>커스텀 컨텐츠입니다.</p></div>",
    "customCss": ".custom-category { padding: 20px; background: #f5f5f5; border-radius: 8px; }"
  }'
```

**Expected Response**: 200 OK with custom template configuration

**Test Case 3.3**: Update only CSS
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/template \
  -H "Content-Type: application/json" \
  -d '{
    "customCss": ".custom-category { padding: 30px; }"
  }'
```

**Expected Response**: 200 OK (HTML content preserved, CSS updated)

---

### 4. Update Visibility

**Endpoint**: `PATCH /api/pim/categories/:id/visibility`

**Test Case 4.1**: Hide category
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/visibility \
  -H "Content-Type: application/json" \
  -d '{
    "visible": false
  }'
```

**Expected Response**: 200 OK with `visibility: false`

**Test Case 4.2**: Show category
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/visibility \
  -H "Content-Type: application/json" \
  -d '{
    "visible": true
  }'
```

**Expected Response**: 200 OK with `visibility: true`

**Test Case 4.3**: Missing visible field
```bash
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/visibility \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response**: 400 Bad Request (validation error)

---

### 5. Integration Tests

**Test Case 5.1**: Multiple configuration updates in sequence
```bash
# 1. Update display settings
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/display-settings \
  -H "Content-Type: application/json" \
  -d '{"showOnMainCategory": true}'

# 2. Update SEO config
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/seo \
  -H "Content-Type: application/json" \
  -d '{"browserTitle": "Test Category"}'

# 3. Update template
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/template \
  -H "Content-Type: application/json" \
  -d '{"templateType": "custom"}'

# 4. Verify all updates persisted
curl -X GET http://localhost:3001/categories/{CATEGORY_ID}
```

**Expected**: All configurations should be present in the final GET response

**Test Case 5.2**: Configuration merging
```bash
# Initial config
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/display-settings \
  -H "Content-Type: application/json" \
  -d '{"showOnMainCategory": true, "pcAndMobile": true}'

# Partial update (should merge, not replace)
curl -X PATCH http://localhost:3001/categories/{CATEGORY_ID}/display-settings \
  -H "Content-Type: application/json" \
  -d '{"mobileOnly": true}'

# Verify
curl -X GET http://localhost:3001/categories/{CATEGORY_ID}
```

**Expected**: All three fields (`showOnMainCategory`, `pcAndMobile`, `mobileOnly`) should be present

---

## Database Verification

After running tests, verify data in the database:

```sql
-- Check a specific category's configuration
SELECT 
  id, 
  name, 
  visibility,
  display_settings,
  seo_config,
  template_config,
  updated_at
FROM product_categories 
WHERE id = 'YOUR_CATEGORY_ID';

-- Verify JSON structure
SELECT 
  display_settings->>'showOnMainCategory' as show_on_main,
  display_settings->'menuPositions'->>'leftSide' as left_menu,
  seo_config->>'browserTitle' as seo_title,
  template_config->>'templateType' as template_type
FROM product_categories 
WHERE id = 'YOUR_CATEGORY_ID';
```

---

## Automated E2E Tests (Optional)

Create a test file: `apps/pim/test/category-config.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PimModule } from '../src/pim.module';

describe('Category Configuration (e2e)', () => {
  let app: INestApplication;
  let testCategoryId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PimModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Create a test category
    const response = await request(app.getHttpServer())
      .post('/categories')
      .send({
        name: 'Test Category',
        slug: 'test-category',
      });
    
    testCategoryId = response.body.id;
  });

  afterAll(async () => {
    // Clean up test category
    await request(app.getHttpServer())
      .delete(`/categories/${testCategoryId}`)
      .expect(200);
    
    await app.close();
  });

  describe('PATCH /categories/:id/display-settings', () => {
    it('should update display settings', () => {
      return request(app.getHttpServer())
        .patch(`/categories/${testCategoryId}/display-settings`)
        .send({
          showOnMainCategory: true,
          pcAndMobile: true,
          productDisplayOrder: 'asc',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.displaySettings).toBeDefined();
          expect(res.body.displaySettings.showOnMainCategory).toBe(true);
          expect(res.body.displaySettings.pcAndMobile).toBe(true);
        });
    });

    it('should return 404 for non-existent category', () => {
      return request(app.getHttpServer())
        .patch('/categories/invalid-uuid/display-settings')
        .send({ showOnMainCategory: true })
        .expect(404);
    });
  });

  describe('PATCH /categories/:id/seo', () => {
    it('should update SEO config', () => {
      return request(app.getHttpServer())
        .patch(`/categories/${testCategoryId}/seo`)
        .send({
          browserTitle: 'Test SEO Title',
          metaDescription: 'Test description',
          metaKeywords: ['test', 'category'],
          showInSearchEngines: true,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.seoConfig).toBeDefined();
          expect(res.body.seoConfig.browserTitle).toBe('Test SEO Title');
          expect(res.body.seoConfig.metaKeywords).toEqual(['test', 'category']);
        });
    });
  });

  describe('PATCH /categories/:id/template', () => {
    it('should update template config', () => {
      return request(app.getHttpServer())
        .patch(`/categories/${testCategoryId}/template`)
        .send({
          templateType: 'custom',
          htmlContent: '<div>Custom</div>',
          customCss: '.custom { color: red; }',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.templateConfig).toBeDefined();
          expect(res.body.templateConfig.templateType).toBe('custom');
        });
    });
  });

  describe('PATCH /categories/:id/visibility', () => {
    it('should update visibility', () => {
      return request(app.getHttpServer())
        .patch(`/categories/${testCategoryId}/visibility`)
        .send({ visible: false })
        .expect(200)
        .expect((res) => {
          expect(res.body.visibility).toBe(false);
        });
    });
  });

  describe('Integration: Multiple updates', () => {
    it('should merge configurations correctly', async () => {
      // Update display settings
      await request(app.getHttpServer())
        .patch(`/categories/${testCategoryId}/display-settings`)
        .send({ showOnMainCategory: true })
        .expect(200);

      // Update SEO
      await request(app.getHttpServer())
        .patch(`/categories/${testCategoryId}/seo`)
        .send({ browserTitle: 'Integration Test' })
        .expect(200);

      // Verify both are present
      const response = await request(app.getHttpServer())
        .get(`/categories/${testCategoryId}`)
        .expect(200);

      expect(response.body.displaySettings.showOnMainCategory).toBe(true);
      expect(response.body.seoConfig.browserTitle).toBe('Integration Test');
    });
  });
});
```

Run E2E tests:
```bash
npm run test:e2e pim
```

---

## Swagger Documentation Testing

1. Start the PIM service
2. Navigate to: `http://localhost:3001/api` (or your configured Swagger path)
3. Verify the following endpoints are documented:
   - `PATCH /categories/{id}/display-settings`
   - `PATCH /categories/{id}/seo`
   - `PATCH /categories/{id}/template`
   - `PATCH /categories/{id}/visibility`
4. Test each endpoint using the Swagger UI "Try it out" feature

---

## Checklist

- [ ] Database migration completed successfully
- [ ] Service starts without errors
- [ ] All display settings endpoints work correctly
- [ ] All SEO configuration endpoints work correctly
- [ ] All template configuration endpoints work correctly
- [ ] Visibility toggle works correctly
- [ ] Configuration merging works (partial updates don't overwrite entire config)
- [ ] Error handling works (404 for non-existent categories)
- [ ] Database stores JSON data correctly
- [ ] Swagger documentation is complete and accurate
- [ ] E2E tests pass (if implemented)

---

## Troubleshooting

### Issue: Migration fails
**Solution**: Check if the columns already exist. Drop them if needed:
```sql
ALTER TABLE product_categories 
  DROP COLUMN IF EXISTS visibility,
  DROP COLUMN IF EXISTS display_settings,
  DROP COLUMN IF EXISTS seo_config,
  DROP COLUMN IF EXISTS template_config;
```
Then re-run the migration.

### Issue: TypeScript errors about missing types
**Solution**: Rebuild the project:
```bash
npm run build:pim
```

### Issue: 404 errors on all endpoints
**Solution**: Verify the controller is properly registered in `pim.module.ts`

### Issue: JSON data not merging correctly
**Solution**: Check that the service methods are spreading the existing config:
```typescript
const seoConfig = {
  ...(category.seoConfig as CategorySeoConfig),
  ...dto,
};
```

---

## Next Steps

After Phase 2 is complete and tested:
1. Proceed to Phase 3: Advanced Features (CSV Import/Export, Audit Logging)
2. Update the frontend to utilize new category configuration options
3. Add caching layer for frequently accessed category configurations
4. Implement category template rendering in the frontend

---

## Support

For issues or questions:
1. Check the main IMPLEMENTATION_GUIDE.md
2. Review the workspace Cursor rules
3. Consult the PIM service README

