'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/common/button';
import {
  DataTable,
  useDataTableSelection,
  TableColumn,
} from '@/components/common/data-table';
import { useCategoryTree } from '@/lib/services/products/queries';
import type { Category } from '@/lib/types/ui/products';
import { Plus, Edit, Trash2, ChevronRight, Move } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { FormInput, FormField } from '@/components/common/form';
import type { CategoryDto } from '@/lib/types/dto/products';

// 카테고리 테이블 컬럼 생성 함수
const createCategoryColumns = (
  expandedCategories: Set<string>,
  handleToggleExpand: (id: string) => void
): TableColumn<Category>[] => [
  {
    key: 'name',
    label: '카테고리명',
    width: '300px',
    align: 'left',
    render: (value, row: Category) => {
      const indent = row.level * 24;
      return (
        <div className="flex items-center gap-2" style={{ paddingLeft: `${indent}px` }}>
          {row.children && row.children.length > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleExpand(row.id);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              {expandedCategories.has(row.id) ? (
                <ChevronRight size={16} className="rotate-90" />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <span className="text-sm font-medium">{row.name || '-'}</span>
        </div>
      );
    },
  },
  {
    key: 'slug',
    label: '슬러그',
    width: '200px',
    align: 'left',
    render: (value) => (
      <span className="text-xs text-gray-600">{String(value || '-')}</span>
    ),
  },
  {
    key: 'level',
    label: '레벨',
    width: '80px',
    align: 'center',
    render: (value) => (
      <span className="text-xs">{String(value ?? '-')}</span>
    ),
  },
  {
    key: 'sortOrder',
    label: '정렬순서',
    width: '100px',
    align: 'center',
    sortable: true,
    render: (value) => (
      <span className="text-xs">{String(value ?? '-')}</span>
    ),
  },
  {
    key: 'isActive',
    label: '활성화',
    width: '100px',
    align: 'center',
    render: (value) => (
      <span
        className={`text-xs px-2 py-1 rounded ${
          value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        }`}
      >
        {value ? '활성' : '비활성'}
      </span>
    ),
  },
  {
    key: 'children',
    label: '하위 카테고리 수',
    width: '120px',
    align: 'center',
    render: (value) => (
      <span className="text-xs">
        {Array.isArray(value) ? value.length : 0}
      </span>
    ),
  },
  {
    key: 'createdAt',
    label: '생성일',
    width: '150px',
    align: 'center',
    sortable: true,
    render: (value) => (
      <span className="text-xs">
        {value instanceof Date
          ? value.toLocaleDateString('ko-KR')
          : value
          ? new Date(value as string).toLocaleDateString('ko-KR')
          : '-'}
      </span>
    ),
  },
  {
    key: 'actions',
    label: '작업',
    width: '150px',
    align: 'center',
    render: (_, row: Category) => (
      <div className="flex items-center justify-center gap-2">
        <CategoryEditButton category={row} />
        <CategoryMoveButton category={row} />
        <CategoryDeleteButton category={row} />
      </div>
    ),
  },
];

// 카테고리 생성 버튼 컴포넌트
function CategoryCreateButton() {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    parentId: '',
    sortOrder: 0,
  });

  // TODO: API 연결 후 useCreateCategory 사용
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('카테고리 생성:', formData);
    // TODO: 실제 API 호출
    setOpen(false);
    setFormData({
      name: '',
      slug: '',
      description: '',
      parentId: '',
      sortOrder: 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus size={16} />
          카테고리 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 추가</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="카테고리명" required>
            <FormInput
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
            />
          </FormField>
          <FormField label="슬러그">
            <FormInput
              value={formData.slug}
              onChange={(e) =>
                setFormData({ ...formData, slug: e.target.value })
              }
            />
          </FormField>
          <FormField label="설명">
            <FormInput
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
            />
          </FormField>
          <FormField label="정렬순서">
            <FormInput
              type="number"
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sortOrder: parseInt(e.target.value) || 0,
                })
              }
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button type="submit">생성</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// 카테고리 수정 버튼 컴포넌트
function CategoryEditButton({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  });

  // TODO: API 연결 후 useUpdateCategory 사용
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('카테고리 수정:', category.id, formData);
    // TODO: 실제 API 호출
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
          onClick={(e) => e.stopPropagation()}
          aria-label="수정"
        >
          <Edit size={16} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 수정</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="카테고리명" required>
            <FormInput
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
            />
          </FormField>
          <FormField label="슬러그">
            <FormInput
              value={formData.slug}
              onChange={(e) =>
                setFormData({ ...formData, slug: e.target.value })
              }
            />
          </FormField>
          <FormField label="설명">
            <FormInput
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
            />
          </FormField>
          <FormField label="정렬순서">
            <FormInput
              type="number"
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sortOrder: parseInt(e.target.value) || 0,
                })
              }
            />
          </FormField>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) =>
                setFormData({ ...formData, isActive: e.target.checked })
              }
              className="w-4 h-4"
            />
            <label htmlFor="isActive" className="text-sm">
              활성화
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button type="submit">수정</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// 카테고리 이동 버튼 컴포넌트
function CategoryMoveButton({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  const [newParentId, setNewParentId] = useState('');

  // TODO: API 연결 후 useMoveCategory 사용
  const handleMove = async () => {
    console.log('카테고리 이동:', category.id, newParentId);
    // TODO: 실제 API 호출
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded"
          onClick={(e) => e.stopPropagation()}
          aria-label="이동"
        >
          <Move size={16} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 이동</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-2">
              이동할 카테고리: <strong>{category.name}</strong>
            </p>
          </div>
          <FormField label="새 부모 카테고리 ID (비워두면 루트로 이동)">
            <FormInput
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              placeholder="부모 카테고리 ID 입력"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button onClick={handleMove}>이동</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 카테고리 삭제 버튼 컴포넌트
function CategoryDeleteButton({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);

  // TODO: API 연결 후 useDeleteCategory 사용
  const handleDelete = async () => {
    console.log('카테고리 삭제:', category.id);
    // TODO: 실제 API 호출
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
          onClick={(e) => e.stopPropagation()}
          aria-label="삭제"
        >
          <Trash2 size={16} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>카테고리 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            정말로 &quot;{category.name}&quot; 카테고리를 삭제하시겠습니까?
            <br />
            이 작업은 되돌릴 수 없습니다.
            {category.children && category.children.length > 0 && (
              <span className="block mt-2 text-red-600">
                ⚠️ 하위 카테고리가 있어 삭제할 수 없습니다.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-red-600 hover:bg-red-700"
            disabled={category.children && category.children.length > 0}
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// CategoryDto를 Category UI 타입으로 변환
function convertCategoryDtoToUI(dto: CategoryDto): Category {
  return {
    id: dto.id,
    name: dto.name,
    slug: '', // CategoryDto에 slug가 없으므로 빈 문자열
    description: dto.description || undefined,
    parentId: dto.parentId || undefined,
    level: 0, // level은 트리 변환 시 계산
    sortOrder: 0, // sortOrder는 DTO에 없을 수 있음
    isActive: dto.isActive,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    children: dto.children ? dto.children.map(convertCategoryDtoToUI) : [],
  };
}

// 카테고리 트리를 평면 배열로 변환 (계층 구조 유지)
function flattenCategoryTree(
  categories: Category[],
  expanded: Set<string> = new Set(),
  level: number = 0
): Category[] {
  const result: Category[] = [];

  for (const category of categories) {
    const categoryWithLevel = {
      ...category,
      level,
    };

    result.push(categoryWithLevel);

    if (category.children && category.children.length > 0) {
      if (expanded.has(category.id)) {
        result.push(
          ...flattenCategoryTree(category.children, expanded, level + 1)
        );
      }
    }
  }

  return result;
}

export default function CategoriesClient() {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');

  const handleToggleExpand = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  // 카테고리 트리 조회 (기존 쿼리 사용)
  const {
    data: categoryTreeData,
    isLoading,
    error,
  } = useCategoryTree();

  // 카테고리를 평면 배열로 변환
  const flattenedCategories = useMemo(() => {
    if (!categoryTreeData?.categories) return [];

    // CategoryDto를 Category UI 타입으로 변환
    const categories = categoryTreeData.categories.map(convertCategoryDtoToUI);

    let filtered = categories;

    // 검색 필터링
    if (searchQuery.trim()) {
      const searchLower = searchQuery.toLowerCase();
      const filterCategory = (cat: Category): Category | null => {
        const matches =
          cat.name.toLowerCase().includes(searchLower) ||
          cat.slug?.toLowerCase().includes(searchLower) ||
          cat.description?.toLowerCase().includes(searchLower);

        const filteredChildren = cat.children
          ?.map(filterCategory)
          .filter((c): c is Category => c !== null) || [];

        if (matches || filteredChildren.length > 0) {
          return {
            ...cat,
            children: filteredChildren,
          };
        }

        return null;
      };

      filtered = categories
        .map(filterCategory)
        .filter((c): c is Category => c !== null);
    }

    return flattenCategoryTree(filtered, expandedCategories);
  }, [categoryTreeData, expandedCategories, searchQuery]);

  const {
    selectionProps,
    selectedRows,
    clearSelection,
  } = useDataTableSelection(
    flattenedCategories as unknown as Record<string, unknown>[],
    'id'
  );

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-800">카테고리를 불러오는 중 오류가 발생했습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* 헤더 영역 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">카테고리 관리</h1>
        <div className="flex items-center gap-2">
          <CategoryCreateButton />
        </div>
      </div>

      {/* 검색 영역 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="카테고리명, 슬러그, 설명으로 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 선택된 항목 정보 */}
      {selectedRows.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800">
            {selectedRows.length}개 항목 선택됨
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={clearSelection}
          >
            선택 해제
          </Button>
        </div>
      )}

      {/* 카테고리 테이블 */}
      <div className="bg-white rounded-lg border">
        <DataTable
          data={flattenedCategories as unknown as Record<string, unknown>[]}
          columns={createCategoryColumns(expandedCategories, handleToggleExpand) as unknown as TableColumn<Record<string, unknown>>[]}
          rowKey="id"
          selectable
          {...selectionProps}
          loading={isLoading}
          emptyMessage="카테고리가 없습니다."
        />
      </div>

      {/* TODO: 페이지네이션 추가 (필요시) */}
    </div>
  );
}

