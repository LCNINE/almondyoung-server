// src/lib/types/ui/common.ts
// 공통 UI 타입 정의

// 기본 페이지네이션 타입
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// 기본 필터 타입
export interface BaseFilter {
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

// 기본 목록 응답 타입
export interface BaseListResponse<T> {
  data: T[];
  pagination: Pagination;
  filters?: Record<string, any>;
}

// 로딩 상태 타입
export interface LoadingState {
  isLoading: boolean;
  error?: string | null;
  isRefreshing?: boolean;
}

// 선택 상태 타입
export interface SelectionState {
  selectedIds: string[];
  isAllSelected: boolean;
  isIndeterminate: boolean;
}

// 모달 상태 타입
export interface ModalState {
  isOpen: boolean;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closable?: boolean;
}

// 토스트 메시지 타입
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// 드롭다운 옵션 타입
export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
  color?: string;
}

// 테이블 컬럼 타입
export interface TableColumn<T = any> {
  key: string;
  title: string;
  dataIndex?: keyof T;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: any, record: T, index: number) => React.ReactNode;
  sorter?: (a: T, b: T) => number;
  filter?: {
    type: 'text' | 'select' | 'date' | 'number';
    options?: DropdownOption[];
    placeholder?: string;
  };
}

// 테이블 정렬 타입
export interface TableSort {
  column: string;
  order: 'asc' | 'desc';
}

// 테이블 필터 타입
export interface TableFilter {
  [key: string]: any;
}

// 폼 필드 타입
export interface FormField {
  name: string;
  label: string;
  type:
    | 'text'
    | 'email'
    | 'password'
    | 'number'
    | 'select'
    | 'textarea'
    | 'checkbox'
    | 'radio'
    | 'date'
    | 'file';
  required?: boolean;
  placeholder?: string;
  options?: DropdownOption[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: RegExp;
    message?: string;
  };
  disabled?: boolean;
  hidden?: boolean;
}

// 폼 상태 타입
export interface FormState<T = any> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isSubmitting: boolean;
  isValid: boolean;
}

// 차트 데이터 타입
export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    borderWidth?: number;
  }[];
}

// 차트 옵션 타입
export interface ChartOptions {
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  plugins?: {
    legend?: {
      display?: boolean;
      position?: 'top' | 'bottom' | 'left' | 'right';
    };
    title?: {
      display?: boolean;
      text?: string;
    };
  };
  scales?: {
    x?: {
      display?: boolean;
      title?: {
        display?: boolean;
        text?: string;
      };
    };
    y?: {
      display?: boolean;
      title?: {
        display?: boolean;
        text?: string;
      };
    };
  };
}

// 파일 업로드 타입
export interface FileUpload {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
}

// 검색 결과 타입
export interface SearchResult<T = any> {
  data: T[];
  total: number;
  query: string;
  filters?: Record<string, any>;
  suggestions?: string[];
}

// 알림 타입
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  actionUrl?: string;
  actionText?: string;
}

// 사용자 액션 타입
export interface UserAction {
  id: string;
  type: 'create' | 'update' | 'delete' | 'view' | 'export' | 'import';
  resource: string;
  resourceId?: string;
  timestamp: string;
  userId: string;
  userName: string;
  details?: Record<string, any>;
}

// 시스템 설정 타입
export interface SystemSettings {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  itemsPerPage: number;
  autoRefresh: boolean;
  refreshInterval: number;
}
