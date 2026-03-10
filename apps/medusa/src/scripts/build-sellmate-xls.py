#!/usr/bin/env python3
"""
sellmate-orders-*.json → 택배양식 XLS 변환 스크립트

실행 방법:
  INPUT=sellmate-orders-20260309.json python3 src/scripts/build-sellmate-xls.py

환경변수:
  INPUT     - 입력 JSON 파일 경로 (필수)
  TEMPLATE  - 템플릿 XLS 경로  기본값: ./택배양식 0309.xls
  OUTPUT    - 출력 XLS 경로   기본값: 입력 파일명 기반 (sellmate-YYYYMMDD.xls)
"""

import json
import os
import sys
import shutil
import xlrd
import xlwt
from xlutils.copy import copy

def build_order_no(display_id: int, created_at: str) -> str:
    # KST 기준 날짜 (UTC+9)
    from datetime import datetime, timezone, timedelta
    kst = timezone(timedelta(hours=9))
    dt = datetime.fromisoformat(created_at.replace('Z', '+00:00')).astimezone(kst)
    date_str = dt.strftime('%Y%m%d')
    return f"{date_str}-1{display_id:06d}"

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

    print(f"[sellmate-xls] {len(orders)}건 주문 로드")

    # 템플릿 경로 결정
    input_dir = os.path.dirname(os.path.abspath(input_path))
    template_candidates = [
        os.environ.get('TEMPLATE', ''),
        os.path.join(input_dir, '택배양식 0309.xls'),
        os.path.join(os.getcwd(), '택배양식 0309.xls'),
    ]
    template_path = next((p for p in template_candidates if p and os.path.exists(p)), None)
    if not template_path:
        print("오류: 템플릿 파일(택배양식 0309.xls)을 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)

    # 출력 경로 결정
    base_name = os.path.basename(input_path).replace('sellmate-orders-', 'sellmate-').replace('.json', '.xls')
    output_path = os.environ.get('OUTPUT') or os.path.join(input_dir, base_name)

    # xlutils.copy: 서식 완전 보존
    rb = xlrd.open_workbook(template_path, formatting_info=True)
    wb = copy(rb)
    ws = wb.get_sheet(0)

    # 행 생성: 성함 | 주소 | 우편번호 | 연락처 | 주문번호 | 상품명 | 옵션명 | 금액 | 수량 | 송장번호 | 상세요구사항
    row_idx = 1
    total_rows = 0
    for order in orders:
        order_no = build_order_no(order['displayId'], order['createdAt'])
        addr = order['shippingAddress']
        recipient = (addr['lastName'] + addr['firstName']).strip()
        full_address = ' '.join(filter(None, [addr['address1'], addr['address2']]))

        for item in order['items']:
            ws.write(row_idx, 0, recipient)
            ws.write(row_idx, 1, full_address)
            ws.write(row_idx, 2, addr['postalCode'])
            ws.write(row_idx, 3, addr['phone'])
            ws.write(row_idx, 4, order_no)
            ws.write(row_idx, 5, item['productTitle'])
            ws.write(row_idx, 6, item['optionName'])
            ws.write(row_idx, 7, item['unitPrice'] * item['quantity'])
            ws.write(row_idx, 8, item['quantity'])
            ws.write(row_idx, 9, '')   # 송장번호
            ws.write(row_idx, 10, '')  # 상세요구사항
            row_idx += 1
            total_rows += 1

    wb.save(output_path)
    print(f"[sellmate-xls] {total_rows}개 행 → {output_path}")

if __name__ == '__main__':
    main()
