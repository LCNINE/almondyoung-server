#!/bin/bash

# Advanced Inventory Search Test Script
# Tests Step 9 implementation

set -e

BASE_URL="http://localhost:3000"
ENDPOINT="/wms/inventory/skus/search/advanced"

echo "🧪 Testing Advanced Inventory Search Endpoint"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local test_name="$1"
    local query="$2"
    
    echo -e "${YELLOW}Testing: ${test_name}${NC}"
    echo "Query: ${query}"
    
    response=$(curl -s -w "\n%{http_code}" "${BASE_URL}${ENDPOINT}${query}")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" == "200" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
        
        # Check if response has expected structure
        if echo "$body" | jq -e '.items, .total, .limit, .offset' > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Response structure valid${NC}"
            total=$(echo "$body" | jq -r '.total')
            items=$(echo "$body" | jq -r '.items | length')
            echo "  Results: $items items (total: $total)"
        else
            echo -e "${RED}✗ Invalid response structure${NC}"
            echo "$body" | jq . 2>/dev/null || echo "$body"
        fi
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code)"
        echo "$body" | jq . 2>/dev/null || echo "$body"
    fi
    
    echo ""
}

# Test 1: Basic search (no filters)
test_endpoint "1. Basic search (no filters)" ""

# Test 2: Search by name
test_endpoint "2. Search by name" "?search=lash&limit=5"

# Test 3: Display mode - below safety
test_endpoint "3. Display mode - below safety" "?displayMode=below_safety&limit=5"

# Test 4: Display mode - with stock
test_endpoint "4. Display mode - with stock" "?displayMode=with_stock&limit=5"

# Test 5: Display mode - out of stock
test_endpoint "5. Display mode - out of stock" "?displayMode=out_of_stock&limit=5"

# Test 6: Filter ungrouped SKUs
test_endpoint "6. Filter ungrouped SKUs" "?isGrouped=false&limit=5"

# Test 7: Filter grouped SKUs
test_endpoint "7. Filter grouped SKUs" "?isGrouped=true&limit=5"

# Test 8: Sorting - name ascending
test_endpoint "8. Sort by name (asc)" "?sortBy=name&sortOrder=asc&limit=5"

# Test 9: Sorting - created date descending
test_endpoint "9. Sort by createdAt (desc)" "?sortBy=createdAt&sortOrder=desc&limit=5"

# Test 10: Pagination
test_endpoint "10. Pagination (page 1)" "?limit=10&offset=0"
test_endpoint "11. Pagination (page 2)" "?limit=10&offset=10"

# Test 12: Combined filters
test_endpoint "12. Combined filters" "?search=lash&displayMode=with_stock&sortBy=name&sortOrder=asc&limit=5"

# Test 13: Date range
test_endpoint "13. Date range filter" "?startDate=2025-01-01&limit=5"

# Test 14: Non-existent group code
test_endpoint "14. Non-existent group code" "?groupCode=NON-EXISTENT-CODE"

echo "=============================================="
echo -e "${GREEN}✓ Test suite complete${NC}"
echo ""
echo "📊 Next steps:"
echo "  1. Check application logs for any errors"
echo "  2. Verify Swagger docs at http://localhost:3000/api-docs"
echo "  3. Test performance with larger datasets"
echo "  4. Run integration tests"

