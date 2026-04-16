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
