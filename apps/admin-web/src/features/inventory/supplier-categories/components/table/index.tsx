'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSupplierCategories, useDeleteSupplierCategory } from '@/lib/services/inventory';
import type { SupplierCategoryDto } from '@/lib/types/dto/inventory';
import { CategoryFormDialog } from '../category-form-dialog';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';

export function SupplierCategoriesTable() {
  const { data: categories, isLoading } = useSupplierCategories();
  const deleteMutation = useDeleteSupplierCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<SupplierCategoryDto | null>(null);

  const handleDelete = async (cat: SupplierCategoryDto) => {
    if (!window.confirm(`"${cat.name}" 분류를 삭제하시겠습니까?`)) return;
    try {
      await deleteMutation.mutateAsync(cat.id);
      toast.success('분류가 삭제되었습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          분류 등록
        </Button>
      </div>

      <div className="px-4 pb-4">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</div>
        ) : !categories?.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">등록된 분류가 없습니다.</div>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">분류명</th>
                <th className="pb-2 font-medium">설명</th>
                <th className="pb-2 font-medium">등록일</th>
                <th className="pb-2 font-medium">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-muted/50">
                  <td className="py-2.5 font-medium">{cat.name}</td>
                  <td className="py-2.5 text-muted-foreground">{cat.description ?? '—'}</td>
                  <td className="py-2.5 text-muted-foreground">
                    {new Date(cat.createdAt).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="py-2.5">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditRow(cat)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(cat)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CategoryFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CategoryFormDialog
        open={!!editRow}
        onOpenChange={(o) => { if (!o) setEditRow(null); }}
        editRow={editRow}
      />
    </>
  );
}
