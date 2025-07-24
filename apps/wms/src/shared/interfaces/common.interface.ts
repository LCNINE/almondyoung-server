// apps/wms/src/shared/interfaces/common.interface.ts
export interface PaginationParams {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
    items: T[];
    total: number;
    page: number;
    totalPages: number;
}

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

export interface AuditableEntity {
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string;
    updatedBy?: string;
}