#!/usr/bin/env python3
"""
sellmate-fo-*.json → 셀메이트 일괄등록 CSV 변환 스크립트

실행:
  INPUT=sellmate-fo-20260616.json python3 src/scripts/build-sellmate-csv.py

환경변수:
  INPUT   - 입력 JSON 파일 경로 (필수)
  OUTPUT  - 출력 CSV 경로  기본값: 입력 파일명 기반 (sellmate-fo-YYYYMMDD.csv)

컬럼 순서 (셀메이트 일괄등록 양식):
  성함 | 주소 | 우편번호 | 연락처 | 주문번호 | 상품명 | 옵션명 | 금액 | 수량 | 송장번호 | 상세요구사항
"""

import csv
import json
import os
import re
import sys


def normalize_phone(phone: str) -> str:
    """전화번호 정규화: 숫자만 추출 후 앞 0 보장, Excel 앞자리 소실 방지를 위해 ="..." 형식 반환."""
    digits = re.sub(r'\D', '', str(phone))
    if not digits:
        return phone
    if not digits.startswith('0'):
        digits = '0' + digits
    # Excel이 CSV를 열 때 앞 0을 숫자로 처리하지 않도록 텍스트 강제
    return f'="{digits}"'


def main():
    input_path = os.environ.get('INPUT') or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not input_path:
        print("오류: INPUT 환경변수 또는 첫 번째 인수로 JSON 파일 경로를 지정하세요.", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(input_path):
        print(f"오류: 파일을 찾을 수 없습니다: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding='utf-8') as f:
        orders = json.load(f)

    print(f"[sellmate-csv] {len(orders)}건 FO 로드")

    input_dir = os.path.dirname(os.path.abspath(input_path))
    base_name = os.path.basename(input_path).replace('.json', '.csv')
    output_path = os.environ.get('OUTPUT') or os.path.join(input_dir, base_name)

    # utf-8-sig: Excel에서 한글 깨짐 없이 열기 위해
    with open(output_path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(['성함', '주소', '우편번호', '연락처', '주문번호', '상품명', '옵션명', '금액', '수량', '송장번호', '상세요구사항'])

        total_rows = 0
        for order in orders:
            addr = order.get('shippingAddress', {})
            recipient = addr.get('recipientName', '')
            full_address = ' '.join(filter(None, [addr.get('roadAddress', ''), addr.get('detailAddress', '')]))
            postal_code = addr.get('postalCode', '')
            phone = normalize_phone(addr.get('phone', ''))
            order_no = str(order.get('displayId', ''))
            delivery_note = addr.get('deliveryNote', '')

            for item in order.get('items', []):
                unit_price = item.get('unitPrice', 0) or 0
                qty = item.get('quantity', 0)
                writer.writerow([
                    recipient,
                    full_address,
                    postal_code,
                    phone,
                    order_no,
                    item.get('skuName', ''),
                    item.get('skuCode', ''),
                    unit_price * qty,
                    qty,
                    '',             # 송장번호
                    delivery_note,
                ])
                total_rows += 1

    print(f"[sellmate-csv] {total_rows}개 행 → {output_path}")


if __name__ == '__main__':
    main()
