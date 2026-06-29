'use client';

import { Pagination, SalesChannelMark } from '@/components/common';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSalesOrders } from '@/lib/services/orders';
import { useState } from 'react';

const TableHeads = [
  { label: '출고요청날짜', key: 'shippingDate' },
  { label: '받는분 이름', key: 'receiver' },
  { label: '오더코드', key: 'orderCode' },
  { label: '진행상태', key: 'status' },
  { label: '판매처', key: 'seller' },
  { label: '출고상품명', key: 'products' },
  { label: '수량', key: 'quantities' },
  { label: '전화번호', key: 'phone' },
  { label: '주소', key: 'address' },
  { label: '우편번호', key: 'zip' },
  { label: '주문번호', key: 'orderId' },
];

export default function RegionalInvoiceTable() {
  const { data: salesOrders } = useSalesOrders();

  // 선택된 행들의 ID를 저장하는 state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // 전체 선택 체크박스 상태 계산
  const isAllSelected =
    salesOrders?.data && selectedRows.size === salesOrders?.data.length;
  const isIndeterminate =
    salesOrders?.data &&
    selectedRows.size > 0 &&
    selectedRows.size < salesOrders?.data.length;

  // 전체 선택/해제 처리
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 모든 행의 ID를 선택
      const allRowIds = new Set(salesOrders?.data.map((item) => item.id));
      setSelectedRows(allRowIds);
    } else {
      // 모든 선택 해제
      setSelectedRows(new Set());
    }
  };

  // 개별 행 선택/해제 처리
  const handleSelectRow = (itemId: string, checked: boolean) => {
    const newSelectedRows = new Set(selectedRows);
    if (checked) {
      newSelectedRows.add(itemId);
    } else {
      newSelectedRows.delete(itemId);
    }
    setSelectedRows(newSelectedRows);
  };

  return (
    <div className="p-4 bg-white">
      <Pagination
        currentPage={1}
        totalPages={1}
        totalItems={1}
        itemsPerPage={1}
        onPageChange={() => {}}
      />

      <div className="border border-gray-300 bg-white overflow-x-auto">
        <Table className="w-full border-collapse text-xs table-fixed">
          <TableHeader>
            <TableRow className="bg-gray-100 border-b border-gray-300">
              {/* 체크박스 헤더 - 전체 선택 기능 */}
              <TableHead className="w-[40px] text-center border-r pl-0 border-gray-300 font-normal text-black h-8">
                <div className="flex justify-center items-center">
                  <Checkbox
                    className="w-4 h-4"
                    checked={isAllSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="모두 선택"
                    // indeterminate 상태 표시 (일부만 선택된 경우)
                    {...(isIndeterminate && {
                      'data-state': 'indeterminate',
                      checked: 'indeterminate' as any,
                    })}
                  />
                </div>
              </TableHead>

              <TableHead className="w-[80px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                출고요청날짜
              </TableHead>
              <TableHead className="w-[70px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                받는분 이름
              </TableHead>
              <TableHead className="w-[120px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                오더코드
              </TableHead>
              <TableHead className="w-[70px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                판매처
              </TableHead>
              <TableHead className="w-[70px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                진행상태
              </TableHead>
              <TableHead className="w-[350px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                출고상품명
              </TableHead>
              <TableHead className="w-[40px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                수량
              </TableHead>
              <TableHead className="w-[100px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                전화번호
              </TableHead>
              <TableHead className="w-[300px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                주소
              </TableHead>
              <TableHead className="w-[60px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                우편번호
              </TableHead>
              <TableHead className="w-[110px] px-2 py-2 text-center border-r border-gray-300 text-black font-bold text-xs h-8">
                통관부호
              </TableHead>
              <TableHead className="w-[120px] px-2 py-2 text-center border-gray-300 text-black font-bold text-xs h-8">
                주문번호
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {salesOrders?.data.map((item: any, rowIdx: any) => {
              const maxProducts = Math.max(item.lines.length, 1);
              const isRowSelected = selectedRows.has(item.id);

              return item.lines.map((line: any, productIdx: any) => (
                <TableRow
                  key={`${rowIdx}-${productIdx}`}
                  className={`border-b border-gray-300 ${
                    isRowSelected ? 'bg-blue-50' : ''
                  }`}
                >
                  {productIdx === 0 && (
                    <>
                      {/* 개별 행 체크박스 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-1 py-3 align-middle"
                      >
                        <div className="flex justify-center items-center">
                          <Checkbox
                            className="w-4 h-4"
                            checked={isRowSelected}
                            onCheckedChange={(checked) =>
                              handleSelectRow(item.id, checked as boolean)
                            }
                            aria-label={`${item.customerName} 선택`}
                          />
                        </div>
                      </TableCell>

                      {/* 출고요청날짜 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black whitespace-pre-line break-words text-xs leading-tight "
                      >
                        {item.orderDate}
                      </TableCell>

                      {/* 받는분 이름 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black break-words text-xs"
                      >
                        {item.customerName}
                      </TableCell>

                      {/* 오더코드 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black text-xs break-words whitespace-pre-line leading-tight max-w-[160px]"
                      >
                        {item.channelOrderId}
                      </TableCell>

                      {/* 판매처 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black text-xs"
                      >
                        <SalesChannelMark
                          channel={item.salesChannel}
                          size="sm"
                        />
                      </TableCell>

                      {/* 진행상태 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black text-xs"
                      >
                        {item.status}
                      </TableCell>
                    </>
                  )}

                  <TableCell className="border-r border-gray-300 px-3 py-3 text-black text-xs align-middle leading-tight break-words whitespace-pre-line">
                    {line.productName}
                  </TableCell>

                  <TableCell className="text-center border-r border-gray-300 px-1 py-3 text-black align-middle text-xs">
                    {line.quantity}
                  </TableCell>

                  {productIdx === 0 && (
                    <>
                      {/* 전화번호 */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black break-words text-xs"
                      >
                        {item.customerPhone}
                      </TableCell>

                      <TableCell
                        rowSpan={maxProducts}
                        className="border-r border-gray-300 px-3 py-3 align-middle text-black text-xs leading-tight break-words whitespace-pre-line"
                      >
                        {item.shippingAddressText}
                      </TableCell>

                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-1 py-3 align-middle text-black text-xs"
                      >
                        {item.postalCode}
                      </TableCell>

                      {/* 통관부호 — 해외직구 주문만 채워짐 (shippingAddress JSON) */}
                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center border-r border-gray-300 px-2 py-3 align-middle text-black break-words text-xs"
                      >
                        {item.shippingAddress?.personalCustomsCode ?? ''}
                      </TableCell>

                      <TableCell
                        rowSpan={maxProducts}
                        className="text-center px-2 py-3 align-middle text-black break-words text-xs leading-tight whitespace-normal"
                      >
                        {item.id}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
