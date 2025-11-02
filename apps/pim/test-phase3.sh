#!/bin/bash

# Phase 3 Feature Test Script
# Tests CSV Import/Export and Audit Logging features

set -e

BASE_URL="http://localhost:3001"
USER_ID="test-user-phase3"

echo "=================================================="
echo "Phase 3 Feature Testing Script"
echo "=================================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Download CSV Template
echo -e "${YELLOW}Test 1: Download CSV Template${NC}"
echo "GET $BASE_URL/api/pim/products/csv/template"
curl -s "$BASE_URL/api/pim/products/csv/template" -o template-downloaded.csv
if [ -f template-downloaded.csv ]; then
    echo -e "${GREEN}✓ Template downloaded successfully${NC}"
    echo "Preview:"
    head -n 3 template-downloaded.csv
else
    echo -e "${RED}✗ Template download failed${NC}"
fi
echo ""

# Test 2: Import Products from CSV
echo -e "${YELLOW}Test 2: Import Products from CSV${NC}"
echo "POST $BASE_URL/api/pim/products/bulk-import"
if [ -f test-products.csv ]; then
    IMPORT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/pim/products/bulk-import" \
      -F "file=@test-products.csv" \
      -F "userId=$USER_ID")
    
    echo "$IMPORT_RESPONSE" | jq '.'
    
    IMPORTED=$(echo "$IMPORT_RESPONSE" | jq -r '.imported')
    if [ "$IMPORTED" -gt 0 ]; then
        echo -e "${GREEN}✓ Imported $IMPORTED products successfully${NC}"
    else
        echo -e "${RED}✗ Import failed${NC}"
    fi
else
    echo -e "${RED}✗ test-products.csv not found${NC}"
fi
echo ""

# Test 3: Export Products to CSV
echo -e "${YELLOW}Test 3: Export All Products to CSV${NC}"
echo "GET $BASE_URL/api/pim/products/export"
curl -s "$BASE_URL/api/pim/products/export" -o exported-products.csv
if [ -f exported-products.csv ]; then
    LINE_COUNT=$(wc -l < exported-products.csv)
    echo -e "${GREEN}✓ Exported $LINE_COUNT lines successfully${NC}"
    echo "Preview:"
    head -n 3 exported-products.csv
else
    echo -e "${RED}✗ Export failed${NC}"
fi
echo ""

# Test 4: Create a Product (triggers audit log)
echo -e "${YELLOW}Test 4: Create Product (triggers audit logging)${NC}"
echo "POST $BASE_URL/api/pim/products"
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/pim/products" \
  -H "Content-Type: application/json" \
  -H "x-user-id: $USER_ID" \
  -H "x-user-email: test@example.com" \
  -d '{
    "name": "Phase 3 Test Product",
    "description": "Created to test audit logging",
    "basePrice": 9999,
    "status": "draft",
    "productType": "regular_sale",
    "userId": "'"$USER_ID"'"
  }')

PRODUCT_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id')
if [ "$PRODUCT_ID" != "null" ] && [ -n "$PRODUCT_ID" ]; then
    echo -e "${GREEN}✓ Product created: $PRODUCT_ID${NC}"
else
    echo -e "${RED}✗ Product creation failed${NC}"
    echo "$CREATE_RESPONSE" | jq '.'
fi
echo ""

# Wait for audit log to be written
sleep 1

# Test 5: Get Recent Audit Logs
echo -e "${YELLOW}Test 5: Get Recent Audit Logs${NC}"
echo "GET $BASE_URL/api/pim/audit/recent?limit=5"
AUDIT_RESPONSE=$(curl -s "$BASE_URL/api/pim/audit/recent?limit=5")
AUDIT_COUNT=$(echo "$AUDIT_RESPONSE" | jq '. | length')
echo "Found $AUDIT_COUNT recent audit entries"
echo "$AUDIT_RESPONSE" | jq '.[0:2]'
if [ "$AUDIT_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Audit logs retrieved successfully${NC}"
else
    echo -e "${RED}✗ No audit logs found${NC}"
fi
echo ""

# Test 6: Get Product Audit History
if [ "$PRODUCT_ID" != "null" ] && [ -n "$PRODUCT_ID" ]; then
    echo -e "${YELLOW}Test 6: Get Product Audit History${NC}"
    echo "GET $BASE_URL/api/pim/audit/products/$PRODUCT_ID"
    PRODUCT_AUDIT=$(curl -s "$BASE_URL/api/pim/audit/products/$PRODUCT_ID")
    PRODUCT_AUDIT_COUNT=$(echo "$PRODUCT_AUDIT" | jq '. | length')
    echo "Found $PRODUCT_AUDIT_COUNT audit entries for product $PRODUCT_ID"
    echo "$PRODUCT_AUDIT" | jq '.'
    if [ "$PRODUCT_AUDIT_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✓ Product audit history retrieved${NC}"
    else
        echo -e "${YELLOW}⚠ No audit entries found for this product${NC}"
    fi
    echo ""
fi

# Test 7: Get Audit Logs by User
echo -e "${YELLOW}Test 7: Get Audit Logs by User${NC}"
echo "GET $BASE_URL/api/pim/audit/by-user/$USER_ID"
USER_AUDIT=$(curl -s "$BASE_URL/api/pim/audit/by-user/$USER_ID")
USER_AUDIT_COUNT=$(echo "$USER_AUDIT" | jq '. | length')
echo "Found $USER_AUDIT_COUNT audit entries for user $USER_ID"
echo "$USER_AUDIT" | jq '.[0:2]'
if [ "$USER_AUDIT_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ User audit logs retrieved${NC}"
else
    echo -e "${YELLOW}⚠ No audit entries for this user${NC}"
fi
echo ""

# Test 8: Get Audit Logs by Action
echo -e "${YELLOW}Test 8: Get Audit Logs by Action (created)${NC}"
echo "GET $BASE_URL/api/pim/audit/by-action/created"
ACTION_AUDIT=$(curl -s "$BASE_URL/api/pim/audit/by-action/created")
ACTION_AUDIT_COUNT=$(echo "$ACTION_AUDIT" | jq '. | length')
echo "Found $ACTION_AUDIT_COUNT 'created' action audit entries"
echo "$ACTION_AUDIT" | jq '.[0:2]'
if [ "$ACTION_AUDIT_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Action audit logs retrieved${NC}"
else
    echo -e "${YELLOW}⚠ No 'created' action entries found${NC}"
fi
echo ""

# Test 9: Test CSV Import Validation (Invalid Data)
echo -e "${YELLOW}Test 9: Test CSV Import Validation (Invalid Data)${NC}"
echo "Creating invalid CSV..."
cat > test-invalid.csv << EOF
productCode,name,basePrice
INVALID001,,not-a-number
INVALID002,Valid Name,-999
EOF

INVALID_RESPONSE=$(curl -s -X POST "$BASE_URL/api/pim/products/bulk-import" \
  -F "file=@test-invalid.csv" \
  -F "userId=$USER_ID")

FAILED_COUNT=$(echo "$INVALID_RESPONSE" | jq -r '.failed')
echo "Response:"
echo "$INVALID_RESPONSE" | jq '.'
if [ "$FAILED_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Validation correctly caught $FAILED_COUNT invalid rows${NC}"
else
    echo -e "${YELLOW}⚠ Validation may not be working as expected${NC}"
fi
rm test-invalid.csv
echo ""

# Summary
echo "=================================================="
echo -e "${GREEN}Phase 3 Feature Tests Complete!${NC}"
echo "=================================================="
echo ""
echo "Generated Files:"
echo "  - template-downloaded.csv"
echo "  - exported-products.csv"
echo ""
echo "To clean up test files:"
echo "  rm template-downloaded.csv exported-products.csv"
echo ""
echo "To view audit logs in detail:"
echo "  curl $BASE_URL/api/pim/audit/recent?limit=20 | jq '.'"

