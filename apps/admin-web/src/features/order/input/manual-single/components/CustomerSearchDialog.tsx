// src/features/order/input/manual-single/components/CustomerSearchDialog.tsx
'use client';

import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCustomerByEmail, useCustomerById } from '@/lib';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (p: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  }) => void; // ✅ phone 추가
  title?: string;
};

export function CustomerSearchDialog({
  open,
  onOpenChange,
  onSelect,
  title = '고객 검색',
}: Props) {
  const [tab, setTab] = useState<'id' | 'email'>('id');

  // 입력값
  const [idInput, setIdInput] = useState('');
  const [emailInput, setEmailInput] = useState('');

  // “검색” 버튼을 눌렀을 때만 훅이 실행되도록 트리거 키
  const [searchId, setSearchId] = useState<string | undefined>(undefined);
  const [searchEmail, setSearchEmail] = useState<string | undefined>(undefined);

  // 스펙 내 훅 사용(엔드포인트: /users/:id, /users/find-by-email)
  const userById = useCustomerById(searchId || '');
  const userByEmail = useCustomerByEmail(searchEmail || '');

  // 현재 탭의 검색 결과만 사용
  const activeResult = useMemo(
    () => (tab === 'id' ? userById : userByEmail),
    [tab, userById, userByEmail]
  );

  const data: any | undefined = activeResult.data;
  const notFound = activeResult.isError;
  const isLoading =
    'isLoading' in activeResult ? activeResult.isLoading : false;

  // ✅ 검색된 사용자의 상세(프로필)까지 로드 → phoneNumber 사용
  const details = useCustomerById(data?.id);
  const phoneNumber = (details.data as any)?.profile?.phoneNumber;

  const handleSearch = () => {
    if (tab === 'id') {
      setSearchEmail(undefined);
      setSearchId(idInput.trim() || undefined);
    } else {
      setSearchId(undefined);
      setSearchEmail(emailInput.trim() || undefined);
    }
  };

  const clearStateOnClose = () => {
    setIdInput('');
    setEmailInput('');
    setSearchId(undefined);
    setSearchEmail(undefined);
    setTab('id');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) clearStateOnClose();
      }}
    >
      <DialogContent className="max-w-2xl bg-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">
            {title}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'id' | 'email')}>
          <TabsList className="mb-3">
            <TabsTrigger value="id">ID로 검색</TabsTrigger>
            <TabsTrigger value="email">이메일로 검색</TabsTrigger>
          </TabsList>

          <TabsContent value="id" className="space-y-3">
            <div>
              <Label className="mb-1 block">사용자 ID (UUID)</Label>
              <div className="flex gap-2">
                <Input
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  placeholder="예: 99999999-9999-4999-8999-333333333333"
                />
                <Button
                  onClick={handleSearch}
                  disabled={isLoading || !idInput.trim()}
                >
                  {isLoading ? '검색중...' : '검색'}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="email" className="space-y-3">
            <div>
              <Label className="mb-1 block">이메일</Label>
              <div className="flex gap-2">
                <Input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="예: customer@example.com"
                />
                <Button
                  onClick={handleSearch}
                  disabled={isLoading || !emailInput.trim()}
                >
                  {isLoading ? '검색중...' : '검색'}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="rounded-md border mt-2 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>전화</TableHead>
                {/* ✅ 표시만 추가 */}
                <TableHead className="w-28 text-right">선택</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    불러오는 중…
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && notFound && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    검색 결과가 없습니다.
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !notFound && data && (
                <TableRow key={data.id}>
                  <TableCell className="font-mono">{data.id}</TableCell>
                  <TableCell>{data.username ?? '-'}</TableCell>
                  <TableCell>{data.email ?? '-'}</TableCell>
                  <TableCell>{phoneNumber ?? '-'}</TableCell>
                  {/* ✅ 프로필의 전화 */}
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => {
                        onSelect({
                          id: data.id,
                          name: data.username ?? '',
                          email: data.email,
                          phone: phoneNumber, // ✅ 함께 전달
                        });
                        onOpenChange(false);
                        clearStateOnClose();
                      }}
                    >
                      선택
                    </Button>
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !notFound && !data && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    검색해주세요.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
