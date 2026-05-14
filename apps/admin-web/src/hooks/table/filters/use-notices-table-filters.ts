import type { Filter } from '@/components/data-table';

export function useNoticesTableFilters(): Filter[] {
  return [
    {
      key: 'category',
      label: '분류',
      type: 'select',
      options: [
        { label: '일반', value: 'general' },
        { label: '이벤트', value: 'event' },
        { label: '배송', value: 'delivery' },
        { label: '서비스', value: 'service' },
      ],
    },
    {
      key: 'isActive',
      label: '공개 여부',
      type: 'select',
      options: [
        { label: '공개', value: 'true' },
        { label: '비공개', value: 'false' },
      ],
    },
    {
      key: 'isPinned',
      label: '상단 고정',
      type: 'select',
      options: [
        { label: '고정', value: 'true' },
        { label: '일반', value: 'false' },
      ],
    },
    {
      key: 'badge',
      label: '뱃지',
      type: 'select',
      options: [
        { label: '중요', value: 'important' },
        { label: '긴급', value: 'urgent' },
        { label: '신규', value: 'new' },
      ],
    },
    {
      key: 'q',
      label: '제목',
      type: 'string',
    },
  ];
}
