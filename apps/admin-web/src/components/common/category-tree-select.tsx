'use client';

import { useState, useEffect } from 'react';
import { useCategoryTree, useCategoryChildren } from '@/lib/services/products/queries';
import type { CategoryDto } from '@/lib/types/dto/products';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/ui';

interface CategoryTreeSelectProps {
  value?: string; // 현재는 사용하지 않지만 향후 초기값 설정에 사용 가능
  onChange?: (categoryId: string, categoryPath: Array<{ id: string; name: string }>) => void;
  className?: string;
}

interface CategoryItemProps {
  category: CategoryDto;
  isSelected: boolean;
  hasChildren: boolean;
  onClick: () => void;
}

function CategoryItem({ category, isSelected, hasChildren, onClick }: CategoryItemProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between w-full px-6 py-3 border-b border-muted-foreground cursor-pointer hover:bg-gray-50 transition-colors',
        isSelected && 'bg-muted'
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          'text-sm leading-5 font-medium',
          isSelected ? 'text-primary' : 'text-foreground'
        )}
      >
        {category.name}
      </span>
      {hasChildren && (
        <ChevronRight
          className={cn(
            'w-4 h-4 flex-shrink-0',
            isSelected ? 'text-primary' : 'text-foreground'
          )}
        />
      )}
    </div>
  );
}

interface CategoryColumnProps {
  categories: CategoryDto[];
  selectedPath: Array<{ id: string; name: string }>;
  onSelect: (category: CategoryDto, level: number) => void;
  level: number;
  nextLevelCategories?: CategoryDto[]; // 다음 레벨 카테고리 데이터 (아이콘 표시용)
  checkedChildrenMap?: Map<string, boolean>; // 각 카테고리 ID에 대한 하위 레벨 존재 여부
}

function CategoryColumn({ categories, selectedPath, onSelect, level, nextLevelCategories, checkedChildrenMap }: CategoryColumnProps) {
  const selectedId = selectedPath[level]?.id;

  return (
    <div className="flex-1 border-r border-muted-foreground last:border-r-0">
      {categories.map((category) => {
        // 하위 레벨이 있는지 확인
        // 1. category.children이 있고 길이가 0보다 크거나
        // 2. checkedChildrenMap에 해당 카테고리가 있고 true이거나
        // 3. 해당 카테고리가 선택되어 있고 nextLevelCategories가 있으면 하위 레벨 있음
        const hasChildren = Boolean(
          (category.children && category.children.length > 0) ||
          checkedChildrenMap?.get(category.id) ||
          (selectedId === category.id && nextLevelCategories && nextLevelCategories.length > 0)
        );

        return (
          <CategoryItem
            key={category.id}
            category={category}
            isSelected={selectedId === category.id}
            hasChildren={hasChildren}
            onClick={() => onSelect(category, level)}
          />
        );
      })}
    </div>
  );
}

// 최대 레벨 지원 (최소 5레벨)
const MAX_LEVELS = 5;

export function CategoryTreeSelect({
  value, // eslint-disable-line @typescript-eslint/no-unused-vars
  onChange,
  className,
}: CategoryTreeSelectProps) {
  const [selectedPath, setSelectedPath] = useState<Array<{ id: string; name: string }>>([]);
  const [levelCategories, setLevelCategories] = useState<CategoryDto[][]>([]);
  // 각 카테고리 ID에 대해 하위 레벨이 있는지 추적
  const [hasChildrenMap, setHasChildrenMap] = useState<Map<string, boolean>>(new Map());

  const { data: treeData, isLoading } = useCategoryTree();

  // 각 레벨별로 훅 호출 (최대 5개 레벨)
  const selectedLevel0Id = selectedPath[0]?.id;
  const selectedLevel1Id = selectedPath[1]?.id;
  const selectedLevel2Id = selectedPath[2]?.id;
  const selectedLevel3Id = selectedPath[3]?.id;
  const selectedLevel4Id = selectedPath[4]?.id;

  const { data: level1Data } = useCategoryChildren(selectedLevel0Id || '');
  const { data: level2Data } = useCategoryChildren(selectedLevel1Id || '');
  const { data: level3Data } = useCategoryChildren(selectedLevel2Id || '');
  const { data: level4Data } = useCategoryChildren(selectedLevel3Id || '');
  const { data: level5Data } = useCategoryChildren(selectedLevel4Id || '');

  // 초기 레벨 0 카테고리 설정
  useEffect(() => {
    if (treeData?.categories && !isLoading) {
      setLevelCategories((prev) => {
        const newLevels = [...prev];
        newLevels[0] = treeData.categories;
        return newLevels;
      });
    }
  }, [treeData?.categories, isLoading]);

  // 레벨별 카테고리 업데이트
  useEffect(() => {
    setLevelCategories((prev) => {
      const newLevels: CategoryDto[][] = [...prev];
      
      // 레벨 0은 이미 설정됨
      if (!newLevels[0] && treeData?.categories) {
        newLevels[0] = treeData.categories;
      }

      // 레벨 1~5 업데이트
      const levelDataArray = [
        level1Data,
        level2Data,
        level3Data,
        level4Data,
        level5Data,
      ];

      for (let i = 0; i < MAX_LEVELS; i++) {
        const parentId = selectedPath[i]?.id;
        const data = levelDataArray[i];
        
        if (data && parentId) {
          // 부모 카테고리에 하위 레벨이 있음을 기록
          setHasChildrenMap((prev) => {
            const newMap = new Map(prev);
            newMap.set(parentId, data.length > 0);
            return newMap;
          });

          newLevels[i + 1] = data.map((cat) => ({
            ...cat,
            path: selectedPath.length >= i + 1
              ? [...selectedPath.slice(0, i + 1), { id: cat.id, name: cat.name }]
              : [{ id: cat.id, name: cat.name }],
          }));
        } else if (!parentId) {
          // 부모가 선택되지 않았으면 해당 레벨과 이후 레벨 초기화
          newLevels.length = i + 1;
          break;
        } else {
          // 데이터가 없으면 해당 레벨 초기화
          if (newLevels[i + 1]) {
            delete newLevels[i + 1];
          }
          // 부모 카테고리에 하위 레벨이 없음을 기록
          if (parentId) {
            setHasChildrenMap((prev) => {
              const newMap = new Map(prev);
              newMap.set(parentId, false);
              return newMap;
            });
          }
        }
      }

      return newLevels;
    });
  }, [level1Data, level2Data, level3Data, level4Data, level5Data, selectedPath, treeData?.categories]);

  const handleSelect = (category: CategoryDto, level: number) => {
    const newPath = [...selectedPath];
    
    // 선택한 레벨까지의 경로 유지하고 이후 레벨 제거
    newPath.length = level;
    newPath.push({ id: category.id, name: category.name });

    setSelectedPath(newPath);

    // 하위 레벨 카테고리 초기화
    setLevelCategories((prev) => {
      const newLevels = [...prev];
      newLevels.length = level + 1; // 선택한 레벨까지만 유지
      return newLevels;
    });

    // 최종 선택 시 onChange 호출
    if (!category.children || category.children.length === 0) {
      onChange?.(category.id, newPath);
    }
  };

  if (isLoading) {
    return (
      <div className={cn('border rounded-md p-4 h-32 flex items-center justify-center', className)}>
        <div className="text-sm text-gray-500">카테고리를 불러오는 중...</div>
      </div>
    );
  }

  if (!treeData?.categories || treeData.categories.length === 0) {
    return (
      <div className={cn('border rounded-md p-4 h-32 flex items-center justify-center', className)}>
        <div className="text-sm text-gray-400">등록된 카테고리가 없습니다.</div>
      </div>
    );
  }

  // 표시할 레벨 결정
  // 레벨 0은 항상 표시, 나머지는 부모가 선택되어 있고 카테고리가 있을 때만 표시
  const visibleColumns: Array<{ level: number; categories: CategoryDto[] }> = [];

  // 레벨 0은 항상 표시
  if (levelCategories[0] && levelCategories[0].length > 0) {
    visibleColumns.push({ level: 0, categories: levelCategories[0] });
  }

  // 레벨 1~5는 조건부로 표시
  for (let i = 1; i <= MAX_LEVELS; i++) {
    if (selectedPath.length >= i && levelCategories[i] && levelCategories[i].length > 0) {
      visibleColumns.push({ level: i, categories: levelCategories[i] });
    }
  }

  return (
    <div className={cn('bg-white border border-muted-foreground rounded-[10px] overflow-hidden', className)}>
      <div className="grid grid-cols-5 w-full max-h-[407px] overflow-y-auto">
        {visibleColumns.map(({ level, categories }) => {
          // 다음 레벨 카테고리 데이터 가져오기 (아이콘 표시용)
          const nextLevelCategories = level < MAX_LEVELS ? levelCategories[level + 1] : undefined;
          
          // 현재 레벨의 각 카테고리에 대해 하위 레벨 존재 여부 확인
          const levelHasChildrenMap = new Map<string, boolean>();
          categories.forEach((category) => {
            // 1. category.children이 있으면 true
            // 2. hasChildrenMap에 기록이 있으면 그 값 사용
            // 3. 선택된 카테고리이고 다음 레벨 데이터가 있으면 true
            const hasChildren = Boolean(
              (category.children && category.children.length > 0) ||
              hasChildrenMap.get(category.id) ||
              (selectedPath[level]?.id === category.id && nextLevelCategories && nextLevelCategories.length > 0)
            );
            levelHasChildrenMap.set(category.id, hasChildren);
          });
          
          return (
            <div
              key={level}
              className="overflow-y-auto border-r border-muted-foreground"
            >
              <CategoryColumn
                categories={categories}
                selectedPath={selectedPath}
                onSelect={handleSelect}
                level={level}
                nextLevelCategories={nextLevelCategories}
                checkedChildrenMap={levelHasChildrenMap}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

