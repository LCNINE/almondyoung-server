/** @format */

'use client';

import { SimplePagination } from '@/components/simple-pagination';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTableRowSelection } from '@/features/order/hooks/use-table-row-selection';
import { Package, Printer } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';

// --- 데이터 타입 정의 (TypeScript) ---
interface Product {
  productCode: string;
  productName: string;
  quantity: number;
}

interface OrderRow {
  id: string;
  requestDate: string;
  requestTime: string;
  isDelayed: boolean;
  recipient: string;
  seller: { name: string; logoUrl: string };
  status: string;
  products: Product[];
  pickingSession: string;
  courier: string;
  trackingNumber: string;
  shippingMethod: string;
  orderNumber: string;
}

function PrintInvoicesByOrderTable() {
  const rows: OrderRow[] = Array.from({ length: 40 }, (_, i) => {
    const sellers = [
      {
        name: '아몬드영',
        logoUrl: 'https://via.placeholder.com/24/FFDDC1/000000?text=A',
      },
      {
        name: '사라센',
        logoUrl: 'https://via.placeholder.com/24/C1FFDD/000000?text=S',
      },
      {
        name: '네일몰',
        logoUrl: 'https://via.placeholder.com/24/DDC1FF/000000?text=N',
      },
      {
        name: '뷰티샵',
        logoUrl: 'https://via.placeholder.com/24/FFC1DD/000000?text=B',
      },
    ];

    const productsList = [
      {
        productCode: `P-${1000 + i}-1`,
        productName: `젤네일 컬러 ${i + 1}호`,
        quantity: Math.floor(Math.random() * 3) + 1,
      },
      {
        productCode: `P-${1000 + i}-2`,
        productName: `탑젤 / 베이스젤 세트 ${i + 1}`,
        quantity: Math.floor(Math.random() * 2) + 1,
      },
    ];

    const seller = sellers[i % sellers.length];
    const day = (i % 28) + 1;
    const date = `2025-07-${day.toString().padStart(2, '0')}`;
    const hour = (8 + (i % 10)).toString().padStart(2, '0');
    const minute = (i * 7) % 60;

    return {
      id: `order-${i + 1}`,
      requestDate: date,
      requestTime: `${hour}:${minute.toString().padStart(2, '0')}`,
      isDelayed: i % 9 === 0, // 9번째마다 지연
      recipient: `고객${i + 1}`,
      seller,
      status:
        i % 4 === 0
          ? '출고 완료'
          : i % 4 === 1
          ? '출고 지시'
          : i % 4 === 2
          ? '출고 요청'
          : '출고 작업',
      products: productsList.slice(0, (i % 2) + 1), // 1~2개 상품
      pickingSession: `${(i % 5) + 1}회차`,
      courier: ['대한통운', '한진택배', '롯데택배', '우체국택배'][i % 4],
      trackingNumber: `${10000000 + i}-3094${500 + i}`,
      shippingMethod: i % 2 === 0 ? '택배' : '퀵서비스',
      orderNumber: `202507${day}${i.toString().padStart(4, '0')}`,
    };
  });

  const tableHeaders = [
    '선택',
    '출고요청날짜',
    '받는분 이름',
    '판매처',
    '진행상태',
    '상품코드',
    '출고상품명',
    '수량',
    '출고회차',
    '택배사',
    '송장번호',
    '출고방식',
    '주문번호',
  ];

  const [pagination, setPagination] = useState({
    pageSize: 50,
    currentPage: 1,
    total: rows.length,
  });

  const {
    selectedRows,
    isAllSelected,
    isIndeterminate,
    handleSelectAll,
    handleSelectRow,
    getSelectedRowsData,
  } = useTableRowSelection({
    rows,
    getRowId: (row: OrderRow) => row.id,
  });

  const startIndex = (pagination.currentPage - 1) * pagination.pageSize;
  const endIndex = startIndex + pagination.pageSize;
  const displayedRows = rows.slice(startIndex, endIndex);

  return (
    <div className="w-full bg-white font-sans">
      <div className="overflow-x-auto">
        <div className="flex items-center justify-between mb-4 mt-4">
          <div className="flex items-center gap-4">
            <p className="text-base text-gray-700 font-medium">
              총 {pagination.total}개의 출고 정보 검색
            </p>

            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                if (selectedRows.size <= 0) {
                  toast.info('출고 취소할 항목을 선택해주세요.');
                  return;
                }

                if (confirm('해당 출고를 취소하시겠습니까?')) {
                  console.log('출고 취소');
                }
              }}
            >
              <Package className="w-4 h-4" />
              출고 취소
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <SimplePagination
              currentPage={pagination.currentPage}
              totalPages={pagination.total}
              onPageChange={(page) =>
                setPagination({ ...pagination, currentPage: page })
              }
            />

            <Select
              value={pagination.pageSize.toString()}
              onValueChange={(value) =>
                setPagination({
                  ...pagination,
                  pageSize: Number(value),
                  currentPage: 1, // 페이지 크기 변경 시 첫 페이지로
                })
              }
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="개수 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10개씩 보기</SelectItem>
                <SelectItem value="20">20개씩 보기</SelectItem>
                <SelectItem value="30">30개씩 보기</SelectItem>
                <SelectItem value="50">50개씩 보기</SelectItem>
                <SelectItem value="100">100개씩 보기</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <table className="w-full text-sm text-center border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {tableHeaders.map((header, index) => (
                <th
                  key={header}
                  className="p-2 font-semibold border border-gray-200"
                >
                  {index === 0 ? (
                    <Checkbox
                      className="w-4 h-4 border-gray-400"
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="모두 선택"
                      {...(isIndeterminate && {
                        'data-state': 'indeterminate',
                        checked: 'indeterminate' as any,
                      })}
                    />
                  ) : (
                    header
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {displayedRows.map((row) => {
              const rowspanCount = row.products.length;
              const isRowSelected = selectedRows.has(row.id);

              return (
                <React.Fragment key={row.id}>
                  {row.products.map((product, productIndex) => (
                    <tr key={product.productCode} className="bg-white">
                      {productIndex === 0 && (
                        <>
                          {/* 1. 선택 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            <Checkbox
                              className="w-4 h-4 border-gray-400"
                              checked={isRowSelected}
                              onCheckedChange={(checked) =>
                                handleSelectRow(row.id, checked as boolean)
                              }
                              aria-label={`${row.id} 선택`}
                            />
                          </td>

                          {/* 2. 출고요청날짜 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            <div className="flex flex-col items-center justify-center">
                              <span>{row.requestDate}</span>
                              <span>{row.requestTime}</span>
                              {row.isDelayed && (
                                <span className="mt-1 text-red-500 text-xs font-bold">
                                  1일 지연
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 3. 받는분 이름 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            {row.recipient}
                          </td>

                          {/* 4. 판매처 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            <div className="flex items-center justify-center gap-2">
                              <img
                                src={row.seller.logoUrl}
                                alt={row.seller.name}
                                className="w-6 h-6 rounded-full"
                              />
                              <span>{row.seller.name}</span>
                            </div>
                          </td>

                          {/* 5. 진행상태 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded-md text-xs font-semibold">
                              {row.status}
                            </span>
                          </td>
                        </>
                      )}

                      {/* 6. 상품코드 */}
                      <td className="p-2 border border-gray-200 text-left">
                        {product.productCode}
                      </td>

                      {/* 7. 출고상품명 */}
                      <td className="p-2 border border-gray-200 text-left  max-w-[365px] ">
                        {product.productName}
                      </td>

                      {/* 8. 수량 */}
                      <td className="p-2 border border-gray-200">
                        {product.quantity}
                      </td>

                      {productIndex === 0 && (
                        <>
                          {/* 9. 출고회차 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            {row.pickingSession}
                          </td>

                          {/* 10. 택배사 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            {row.courier}
                          </td>

                          {/* 11. 송장번호 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            <div className="flex flex-col items-center justify-center">
                              <Printer className="w-4 h-4" />
                            </div>
                          </td>

                          {/* 12. 출고방식 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            {row.shippingMethod}
                          </td>

                          {/* 13. 주문번호 */}
                          <td
                            rowSpan={rowspanCount}
                            className="p-2 border border-gray-200 align-middle"
                          >
                            {row.orderNumber}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PrintInvoicesByOrderTable;
