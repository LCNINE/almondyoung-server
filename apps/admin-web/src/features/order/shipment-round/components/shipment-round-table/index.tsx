/** @format */
'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTableRowSelection } from '@/features/order/hooks/use-table-row-selection';
import { Clock, Printer } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface OrderRow {
  id: string;
  shippingDate: string; // 출고지시일
  shippingBatch: string; // 회차
  sellerCategory: string; // 판매처 분류
  manager: string; // 진행 담당자
  orderCount: number; // 출고지시(송장단위)
  workingCount: number; // 출고작업중
  completedCount: number; // 출고완료
  duration: string; // 소요시간
  courier: string; // 택배사명
  courierStatus: string; // 접수 상태
  orderId: string; // 주문 ID (내부키)
}

export default function OrderShipmentRoundTable() {
  const rows: OrderRow[] = [
    {
      id: 'row-1',
      shippingDate: '2025-07-01 11:44',
      shippingBatch: '1',
      sellerCategory: '아몬드영',
      manager: '엄마나라',
      orderCount: 20,
      workingCount: 0,
      completedCount: 0,
      duration: '00:32:10',
      courier: '대한통운',
      courierStatus: '접수완료',
      orderId: '20319212-2304958',
    },
    {
      id: 'row-2',
      shippingDate: '2025-07-01 12:15',
      shippingBatch: '2',
      sellerCategory: '스마트스토어',
      manager: '홍길동',
      orderCount: 35,
      workingCount: 5,
      completedCount: 10,
      duration: '01:12:45',
      courier: '로젠택배',
      courierStatus: '대기중',
      orderId: '20319212-2304960',
    },
    {
      id: 'row-3',
      shippingDate: '2025-07-01 13:00',
      shippingBatch: '3',
      sellerCategory: '쿠팡',
      manager: '김철수',
      orderCount: 50,
      workingCount: 20,
      completedCount: 15,
      duration: '00:54:20',
      courier: 'CJ대한통운',
      courierStatus: '접수완료',
      orderId: '20319212-2304975',
    },
  ];

  const {
    selectedRows,
    isAllSelected,
    isIndeterminate,
    handleSelectAll,
    handleSelectRow,
    clearSelection,
    getSelectedRowsData,
  } = useTableRowSelection({
    rows,
    getRowId: (row) => row.id,
  });

  // 선택된 행들의 실제 데이터
  const selectedRowsData = getSelectedRowsData(rows, (row) => row.id);

  // 일괄 출력 처리
  const handleBulkPrint = () => {
    if (selectedRows.size === 0) {
      return toast.error('출력할 로우를 선택해주세요.');
    }
    console.log('송장 일괄 출력:', selectedRowsData);
    // 실제 출력 로직 구현
  };

  return (
    <div className="p-4 bg-white">
      {/* 헤더 섹션 */}
      <div className="text-sm mb-4 flex items-center justify-between h-9 ">
        <div className="flex items-center gap-4">
          <span>총 {rows.length}개의 출고정보 검색</span>
          {selectedRows.size > 0 && (
            <span className="text-blue-600 font-medium">
              ({selectedRows.size}개 선택됨)
            </span>
          )}
        </div>

        {/* 일괄 처리 버튼 */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={clearSelection}>
              선택 해제
            </Button>
            <Button variant="outline" size="sm" onClick={handleBulkPrint}>
              <Printer className="w-4 h-4 mr-2" />
              송장 일괄 출력 ({selectedRows.size}건)
            </Button>
          </div>
        )}

        {/* 개수 선택 */}
        {selectedRows.size === 0 && (
          <div className="flex items-center gap-2">
            <Select value="10" onValueChange={() => {}}>
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
        )}
      </div>

      {/* 테이블 */}
      <div className="border border-gray-300 bg-white overflow-x-auto">
        <Table className="w-full border-collapse text-xs">
          <TableHeader>
            <TableRow className="bg-gray-50">
              {/* 체크박스 헤더 */}
              <TableHead className="w-[50px] text-center border border-gray-200 p-0 h-[40px]">
                <div className="flex justify-center items-center h-full">
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
                </div>
              </TableHead>

              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                출고지시일
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                회차
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                판매처 분류
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                진행 담당자
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                출고지시
                <br />
                (송장단위)
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                출고작업중
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                출고완료
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                소요시간
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                피킹리스트
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                택배접수
              </TableHead>
              <TableHead className="text-center border border-gray-200 px-2 py-2 text-gray-700 font-medium text-xs h-[40px]">
                운송장 출력
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isRowSelected = selectedRows.has(row.id);

              return (
                <TableRow
                  key={row.id}
                  className={`${
                    isRowSelected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {/* 체크박스 */}
                  <TableCell className="text-center border border-gray-200 p-0 align-middle">
                    <div className="flex justify-center items-center h-full">
                      <Checkbox
                        className="w-4 h-4 border-gray-400"
                        checked={isRowSelected}
                        onCheckedChange={(checked) =>
                          handleSelectRow(row.id, checked as boolean)
                        }
                        aria-label={`${row.id} 선택`}
                      />
                    </div>
                  </TableCell>

                  {/* 출고지시일 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 align-middle text-gray-900 text-xs">
                    {row.shippingDate}
                  </TableCell>

                  {/* 회차 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2">
                    <Button
                      asChild
                      className="underline underline-offset-2 cursor-pointer text-gray-900 text-xs "
                      variant="link"
                      size="sm"
                    >
                      <Link
                        href={`/order/print-invoices-by-order?shippingBatch=${row.shippingBatch}&orderId=${row.orderId}&modal=true`}
                      >
                        {row.shippingBatch}회차
                      </Link>
                    </Button>
                  </TableCell>

                  {/* 판매처 분류 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 text-gray-900 text-xs">
                    {row.sellerCategory}
                  </TableCell>

                  {/* 진행 담당자 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 text-gray-900 text-xs">
                    {row.manager}
                  </TableCell>

                  {/* 출고지시(송장단위) */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 text-gray-500 text-xs">
                    {row.orderCount}
                  </TableCell>

                  {/* 출고작업중 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 text-gray-500 text-xs">
                    {row.workingCount}
                  </TableCell>

                  {/* 출고완료 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 text-gray-500 text-xs">
                    {row.completedCount}
                  </TableCell>

                  {/* 소요시간 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 align-middle">
                    <div className="flex justify-center items-center">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-gray-600" />
                      </div>
                      <span className="ml-2 text-gray-700">{row.duration}</span>
                    </div>
                  </TableCell>

                  {/* 피킹리스트 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 align-middle">
                    <button className="w-8 h-8 rounded bg-gray-600 hover:bg-gray-700 flex items-center justify-center mx-auto transition-colors">
                      <Printer className="w-4 h-4 text-white" />
                    </button>
                  </TableCell>

                  {/* 택배접수 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 align-middle text-xs">
                    <div className="text-gray-900">{row.courier}</div>
                    <div
                      className={
                        row.courierStatus === '접수완료'
                          ? 'text-blue-500'
                          : 'text-gray-500'
                      }
                    >
                      {row.courierStatus}
                    </div>
                  </TableCell>

                  {/* 운송장 출력 */}
                  <TableCell className="text-center border border-gray-200 px-2 py-2 align-middle">
                    <button className="w-8 h-8 rounded bg-blue-500 hover:bg-blue-600 flex items-center justify-center mx-auto transition-colors">
                      <Printer className="w-4 h-4 text-white" />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* 하단 선택 정보 (선택적) */}
      {selectedRows.size > 0 && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            총 {selectedRows.size}개 항목이 선택되었습니다.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={clearSelection}>
              선택 해제
            </Button>
            <Button size="sm" onClick={handleBulkPrint}>
              선택 항목 처리
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
