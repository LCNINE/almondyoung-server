/** @format */

'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Printer, Search, Send, Settings } from 'lucide-react';
import { useState } from 'react';
import Barcode from '../components/barcode';
import PickingTable from '../components/picking-table';
import ProductGrid from '../components/product-grid.tsx';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function PickingListTemplate() {
  const [searchCode, setSearchCode] = useState('');

  return (
    <div className="min-h-screen bg-background ">
      <div className="mx-auto max-w-8xl">
        {/* Header */}
        <div className="mb-6 flex gap-2">
          <Label htmlFor="picking-list-code" className="text-sm font-bold">
            피킹리스트 코드
          </Label>

          <div className="relative">
            <Input
              id="picking-list-code"
              type="text"
              placeholder="피킹리스트 코드"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              className="max-w-xs bg-card pr-6"
            />
            <Button
              variant="ghost"
              className="absolute right-0 top-0 h-full px-3 cursor-pointer hover:scale-110 transition-all duration-300"
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 grid-cols-2 ">
          {/* Left Section - Picking List */}
          <Card className="p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="">
                  <h1 className="text-2xl font-bold text-foreground">
                    피킹리스트
                  </h1>
                </div>

                <div className="">
                  <Barcode value="1234567890123" />
                </div>

                <div className="flex gap-16 text-sm ">
                  <div className="space-y-1">
                    <div className="flex gap-6">
                      <span className="text-muted-foreground">날짜</span>
                      <span className="font-medium">2025-07-08</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-muted-foreground">출고 회차수</span>
                      <span className="font-medium">1회</span>
                    </div>
                  </div>
                  <div className="space-y-1 ">
                    <div className="flex gap-6">
                      <span className="text-muted-foreground">출고지시</span>
                      <span className="font-medium">20</span>
                    </div>

                    <div className="flex gap-6">
                      <span className="text-muted-foreground">상품 수</span>
                      <span className="font-medium">840</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Picking Table */}
              <ScrollArea className="h-[600px]">
                <PickingTable />
              </ScrollArea>
            </div>
          </Card>

          {/* Right Section - Product Code */}
          <Card className="p-6">
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <h2 className="font-bold text-foreground">제품 코드</h2>

                <div>
                  <Input type="text" placeholder="제품 코드" className="" />
                </div>
              </div>

              {/* Product Name */}
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  제품명: 노온드 아이패치
                </h3>
              </div>

              {/* Product Grid */}
              <ScrollArea className="h-[600px]">
                <ProductGrid />
              </ScrollArea>

              {/* Action Buttons */}
              <div className="flex gap-3 ">
                <Button
                  variant="outline"
                  className="flex-1 bg-transparent border-gray-300 cursor-pointer"
                >
                  <Send className="mr-2 h-4 w-4" />
                  검수 발송
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 bg-transparent  border-gray-300 cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  취소요청 관리
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Action Button */}
      <div className="flex justify-start mt-4">
        <Button variant="outline" className="cursor-pointer ">
          <Printer className="mr-2 h-4 w-4" />
          피킹리스트 인쇄
        </Button>
      </div>
    </div>
  );
}
