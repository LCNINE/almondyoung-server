'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/common/button';
import {
  FormField,
  FormSelect,
  FormInput,
  FormRadioGroup,
  FormDateRangePicker,
  FilterLayout,
} from '@/components/common/form';
import {
  DataTable,
  useDataTableSelection,
  TableColumn,
} from '@/components/common/data-table';
import { useMasters } from '@/lib/services/products/queries';
import type { Master } from '@/lib/types/ui/products';
import {
  Download,
  Trash2,
  Settings,
  FileText,
  Zap,
  Search,
} from 'lucide-react';
import { SimplePagination } from '@/components/simple-pagination';

// 검색 필터 타입
interface SearchFilters {
  searchType: string;
  category: string;
  origin: string;
  designer: string;
  dateType: string;
  dateRange: {
    from?: Date;
    to?: Date;
  } | null;
  matchingStatus: string;
  productCode: string;
}

// 상품 목록 컬럼 정의
const productColumns: TableColumn<Master>[] = [
  {
    key: 'id',
    label: '품번코드',
    width: '118px',
    align: 'center',
    render: (_, row: Master) => (
      <div className="break-words text-xs">{row.id || '-'}</div>
    ),
  },
  {
    key: 'channels',
    label: '판매채널 / 상품 링크',
    width: '133px',
    align: 'center',
    render: (_, row: Master) => {
      return <span className="text-sm">{row.channel?.name || '-'}</span>;
    },
  },
  {
    key: 'image',
    label: '이미지',
    width: '133px',
    align: 'center',
    render: (_, row: Master) => {
      return (
        <div className="w-16 h-16 flex items-center justify-center overflow-hidden mx-auto">
          <img
            src={row.thumbnail || '/placeholder.svg'}
            alt={row.name || '상품 이미지'}
            className="w-full h-full object-cover"
          />
        </div>
      );
    },
  },
  {
    key: 'productInfo',
    label: '상품명/분류/브랜드 명',
    width: 'auto',
    align: 'left',
    render: (_, row: Master) => (
      <div className="space-y-1 break-words">
        <div className="font-medium text-blue-800 text-sm leading-tight break-words">
          {row.name || '-'}
        </div>
        <div className="text-sm text-gray-500 break-words">
          {row.categoryId || '-'}
        </div>
        <div className="text-sm text-gray-500 break-words">
          {row.brand || '-'}
        </div>
      </div>
    ),
  },
  {
    key: 'options',
    label: '옵션제목/옵션수',
    width: '179px',
    align: 'center',
    render: (_, row: Master) => (
      <span className="text-sm text-blue-900">
        {row.variants?.length ? `타입 / ${row.variants.length}` : '단일상품'}
      </span>
    ),
  },
  {
    key: 'origin',
    label: '원산지',
    width: '82px',
    align: 'center',
    render: (_, row: Master) => {
      return <span className="text-sm">{row.origin || '-'}</span>;
    },
  },
  {
    key: 'pricing',
    label: '판매가/멤버십가/도매가',
    width: '131px',
    align: 'right',
    render: (_, row: Master) => {
      return (
        <div className="space-y-1 text-sm">
          <div className="font-medium">
            {row.basePrice ? row.basePrice.toLocaleString() : '-'}
          </div>
          <div className="text-gray-500">
            {row.membershipPrice ? row.membershipPrice.toLocaleString() : '-'}
          </div>
          <div className="text-gray-500">
            {row.wholesalePrice ? row.wholesalePrice.toLocaleString() : '-'}
          </div>
        </div>
      );
    },
  },
  {
    key: 'actions',
    label: '기능',
    width: '115px',
    align: 'center',
    render: () => (
      <div className="space-y-2">
        <Button size="sm" variant="secondary" className="h-6 text-xs">
          <Zap className="w-3 h-3 mr-1" />
          재매칭
        </Button>
        <div className="text-xs text-blue-600">[매칭수정]</div>
      </div>
    ),
  },
  {
    key: 'dates',
    label: '등록일시/수정일시/상태변경일시',
    width: '170px',
    align: 'center',
    render: (_, row: Master) => (
      <div className="space-y-1 text-sm">
        <div>
          {row.createdAt
            ? new Date(row.createdAt).toLocaleDateString('ko-KR')
            : '-'}
        </div>
        <div>
          {row.updatedAt
            ? new Date(row.updatedAt).toLocaleDateString('ko-KR')
            : '-'}
        </div>
      </div>
    ),
  },
];

export default function ProductListClient() {
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    searchType: 'all',
    category: 'all',
    origin: 'all',
    designer: 'all',
    dateType: 'all',
    dateRange: null,
    matchingStatus: 'all',
    productCode: '',
  });

  const [statusFilters, setStatusFilters] = useState<{
    sale: boolean;
    noSale: boolean;
    display: boolean;
    noDisplay: boolean;
  }>({
    sale: false,
    noSale: false, // 기본값을 false로 변경 - 모든 상품 표시
    display: false,
    noDisplay: false,
  });

  // 상품 데이터 조회
  const {
    data: mastersData,
    isLoading,
    isError,
    error,
  } = useMasters({
    page: 1,
    limit: 50,
  });

  // 디버깅을 위한 로그
  console.log('Masters data:', mastersData);
  console.log('Loading:', isLoading);
  console.log('Error:', error);
  console.log('Is Error:', isError);

  const masters = useMemo(() => mastersData?.data || [], [mastersData?.data]);

  // 매칭 대기 상품 수 계산 (옵션 기준)
  const pendingMatchingCount = useMemo(() => {
    return masters.reduce((count, master) => {
      const variants = master.variants || [];
      const matchedVariants = variants.filter(() => {
        // variant에 연결된 channelProduct가 있는지 확인
        return (
          master.channelProducts?.some((cp) => cp.masterId === master.id) ||
          false
        );
      });
      return count + (variants.length - matchedVariants.length);
    }, 0);
  }, [masters]);

  // 선택 기능
  const { selectionProps, selectedRows } = useDataTableSelection(masters, 'id');

  // 상태별 필터링된 데이터
  const filteredData = useMemo(() => {
    // 필터가 하나도 활성화되지 않았으면 모든 데이터 반환
    const hasActiveFilter = Object.values(statusFilters).some(
      (value) => value === true
    );
    if (!hasActiveFilter) {
      return masters;
    }

    return masters.filter((master) => {
      // 상태 필터 적용
      // sale이 true이고 상품이 active가 아니면 제외
      if (statusFilters.sale && master.status !== 'active') return false;
      // noSale이 true이고 상품이 active이면 제외
      if (statusFilters.noSale && master.status === 'active') return false;
      // display와 noDisplay는 아직 구현되지 않음

      return true;
    });
  }, [masters, statusFilters]);

  // 디버깅을 위한 로그
  console.log('Masters:', masters);
  console.log('Status filters:', statusFilters);
  console.log('Filtered data:', filteredData);

  const handleSearch = () => {
    // 검색 로직 구현
    console.log('검색:', searchFilters);
  };

  const handleStatusChange = (status: keyof typeof statusFilters) => {
    setStatusFilters((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  };

  const handleBulkAction = (action: string) => {
    console.log(`${action} 실행:`, selectedRows);
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">상품 목록</h1>
        <p className="text-gray-600">
          상품을 관리하고 상태를 변경할 수 있습니다.
        </p>
      </div>

      {/* 검색 필터 */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <FilterLayout
          columns={4}
          gap="md"
          className="mb-4 !p-0"
          showBorder={false}
          padding="sm"
        >
          {/* 검색 타입 */}
          <FormField label="검색항목">
            <FormSelect
              value={searchFilters.searchType}
              onValueChange={(value) =>
                setSearchFilters((prev) => ({ ...prev, searchType: value }))
              }
              options={[
                { value: 'all', label: '통합 검색' },
                { value: 'name', label: '상품명' },
                { value: 'code', label: '상품코드' },
              ]}
              placeholder="통합 검색"
            />
          </FormField>

          {/* 분류 */}
          <FormField label="분류">
            <FormSelect
              value={searchFilters.category}
              onValueChange={(value) =>
                setSearchFilters((prev) => ({ ...prev, category: value }))
              }
              options={[
                { value: 'all', label: '전체' },
                { value: 'nail', label: '네일' },
                { value: 'skincare', label: '스킨케어' },
              ]}
              placeholder="분류 선택"
            />
          </FormField>

          {/* 원산지 */}
          <FormField label="원산지">
            <FormSelect
              value={searchFilters.origin}
              onValueChange={(value) =>
                setSearchFilters((prev) => ({ ...prev, origin: value }))
              }
              options={[
                { value: 'all', label: '전체' },
                { value: 'korea', label: '한국' },
                { value: 'china', label: '중국' },
              ]}
              placeholder="원산지 선택"
            />
          </FormField>

          {/* 디자이너 */}
          <FormField label="선택사항">
            <FormSelect
              value={searchFilters.designer}
              onValueChange={(value) =>
                setSearchFilters((prev) => ({ ...prev, designer: value }))
              }
              options={[
                { value: 'all', label: '전체' },
                { value: 'designer1', label: '디자이너1' },
                { value: 'designer2', label: '디자이너2' },
              ]}
              placeholder="전체 상품 디자이너"
            />
          </FormField>
        </FilterLayout>

        {/* 날짜 필터 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <FormField label="일자">
            <FormRadioGroup
              value={searchFilters.dateType}
              onValueChange={(value) =>
                setSearchFilters((prev) => ({ ...prev, dateType: value }))
              }
              options={[
                { value: 'all', label: '전체' },
                { value: 'today', label: '오늘' },
                { value: 'yesterday', label: '어제' },
                { value: 'week', label: '일주일' },
                { value: 'month', label: '당월' },
                { value: 'lastMonth', label: '전월' },
                { value: 'quarter', label: '3개월' },
                { value: 'custom', label: '임의기간' },
              ]}
              orientation="horizontal"
            />
          </FormField>

          <FormField label="매칭 여부">
            <FormRadioGroup
              value={searchFilters.matchingStatus}
              onValueChange={(value) =>
                setSearchFilters((prev) => ({ ...prev, matchingStatus: value }))
              }
              options={[
                { value: 'all', label: '전체' },
                { value: 'waiting', label: '매칭대기 상품만 표시' },
                { value: 'matched', label: '매칭된 상품만 표시' },
              ]}
              orientation="horizontal"
            />
          </FormField>
        </div>

        {/* 날짜 범위 입력 */}
        {searchFilters.dateType === 'custom' && (
          <div className="mb-4">
            <FormField label="날짜 범위">
              <FormDateRangePicker
                value={
                  searchFilters.dateRange
                    ? {
                        from: searchFilters.dateRange.from,
                        to: searchFilters.dateRange.to,
                      }
                    : undefined
                }
                onChange={(range) =>
                  setSearchFilters((prev) => ({
                    ...prev,
                    dateRange: range
                      ? {
                          from: range.from,
                          to: range.to,
                        }
                      : null,
                  }))
                }
                placeholder="날짜 범위를 선택하세요"
              />
            </FormField>
          </div>
        )}

        {/* 상품코드 검색 */}
        <div className="flex items-end gap-4 mb-4">
          <div className="flex-1">
            <FormField label="상품코드">
              <FormInput
                placeholder="100203"
                value={searchFilters.productCode}
                onChange={(e) =>
                  setSearchFilters((prev) => ({
                    ...prev,
                    productCode: e.target.value,
                  }))
                }
              />
            </FormField>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleSearch}
              icon={Search}
              variant="primary"
              size="sm"
              className="h-8"
            >
              검색
            </Button>
          </div>
        </div>

        {/* 상태 필터 */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">상태:</span>
          <div className="flex items-center gap-2">
            <Button
              variant={statusFilters.sale ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleStatusChange('sale')}
              className="h-8"
            >
              판매함
            </Button>
            <Button
              variant={statusFilters.noSale ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleStatusChange('noSale')}
              className="h-8"
            >
              판매안함
            </Button>
            <Button
              variant={statusFilters.display ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleStatusChange('display')}
              className="h-8"
            >
              진열함
            </Button>
            <Button
              variant={statusFilters.noDisplay ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleStatusChange('noDisplay')}
              className="h-8"
            >
              진열안함
            </Button>
          </div>
        </div>
      </div>

      {/* 액션 버튼들 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button icon={Download} variant="primary" size="sm" className="h-8">
            엑셀 다운로드
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8"
            onClick={() => handleBulkAction('delete')}
            disabled={selectedRows.length === 0}
            icon={Trash2}
          >
            선택 삭제
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8"
            onClick={() => handleBulkAction('status')}
            disabled={selectedRows.length === 0}
          >
            선택 상품상태변경
          </Button>
          <Button variant="secondary" size="sm" className="h-8">
            상품 삭제 리스트
          </Button>
        </div>

        <div className="text-sm text-gray-600">총 {filteredData.length}건</div>
      </div>

      {/* 매칭 대기 알림 */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs">!</span>
          </div>
          <span className="text-red-700 font-semibold">
            매칭 대기 상품(옵션기준) {pendingMatchingCount}개
          </span>
        </div>
      </div>

      {/* 상품 테이블 */}
      <div className="bg-white rounded-lg border">
        <DataTable
          data={masters as unknown as Record<string, unknown>[]}
          columns={productColumns as unknown as TableColumn<Record<string, unknown>>[]}
          rowKey="id"
          selectable
          {...selectionProps}
          loading={isLoading}
          emptyMessage="상품이 없습니다."
          getRowClassName={(row) => {
            // 매칭 대기 상품은 빨간색 배경 (임시로 draft 상태로 처리)
            if (row.status === 'draft') return 'bg-red-50';
            return '';
          }}
        />
      </div>

      {/* 페이지네이션 */}
      <div className="mt-6 flex justify-center">
        <SimplePagination
          currentPage={1}
          totalPages={1}
          onPageChange={() => {}}
        />
      </div>
    </div>
  );
}
