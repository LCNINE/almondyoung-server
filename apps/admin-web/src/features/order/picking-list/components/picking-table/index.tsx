/** @format */

'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '@/components/ui/table';

interface PickingItem {
  id: number;
  sequence: number;
  location: string;
  productName: string;
  quantity: number;
  grid: { id: number; value: number }[];
}

const initialItems: PickingItem[] = [
  {
    id: 1,
    sequence: 1,
    location: 'A-10-35',
    productName: '노온드 아이패치',
    quantity: 700,
    grid: [
      { id: 1, value: 50 },
      { id: 2, value: 50 },
      { id: 3, value: 200 },
      { id: 4, value: 250 },
      { id: 5, value: 150 },
    ],
  },
  {
    id: 2,
    sequence: 2,
    location: 'B-7-21',
    productName: '노온드 선라이저 퓨어 80ml 250ml',
    quantity: 3,
    grid: [
      { id: 1, value: 1 },
      { id: 2, value: 1 },
      { id: 3, value: 1 },
      { id: 4, value: 0 },
      { id: 5, value: 0 },
    ],
  },
  {
    id: 3,
    sequence: 3,
    location: 'B-7-21',
    productName: '노온드 선라이저 퓨어 80ml 250ml',
    quantity: 3,
    grid: [
      { id: 1, value: 1 },
      { id: 2, value: 1 },
      { id: 3, value: 1 },
      { id: 4, value: 0 },
      { id: 5, value: 0 },
    ],
  },
];

export default function PickingTable() {
  const [items] = useState<PickingItem[]>(initialItems);

  return (
    <div className="overflow-x-auto">
      <Table className="border-2">
        <TableHeader>
          <TableRow className="bg-[#F8F8F8]">
            <TableHead className="w-[70px] text-center">순번</TableHead>
            <TableHead className="w-[159px] border-l-2 border-r-2 text-center">
              로케이션
            </TableHead>
            <TableHead className="w-[366px] text-center">제품명</TableHead>
            <TableHead className="border-l-2 text-center w-[114px]">
              수량
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {items.map((item) => (
            <>
              {/* Main data row */}
              <TableRow key={`main-${item.id}`}>
                <TableCell className="text-center">{item.sequence}</TableCell>
                <TableCell className="font-medium border-l-2 border-r-2 text-center">
                  {item.location}
                </TableCell>
                <TableCell>{item.productName}</TableCell>
                <TableCell className="text-center border-l-2">
                  {item.quantity}
                </TableCell>
              </TableRow>

              {/* Grid value row */}
              <TableRow key={`grid-${item.id}`} className="bg-[#F8F8F8]">
                <TableCell colSpan={4} className="border-t-2 border-b-2">
                  <div className="flex items-center gap-2">
                    {item.grid.map((grid) => (
                      <div className="flex items-center">
                        <span className="text-xs text-muted-foreground w-6 text-center">
                          {grid.id}
                        </span>
                        <div className="h-8 min-w-[46px] max-w-16  text-xs bg-[#FFFFFF] rounded-md shadow flex items-center  justify-start pl-2">
                          {grid.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
