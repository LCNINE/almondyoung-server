/**
 * Date transformation utilities for consistent DTO mapping
 */
export class DateMapper {
  /**
   * Convert Date to ISO 8601 string, ensuring NOT NULL
   * Use for createdAt and updatedAt fields
   *
   * @param date - Date object from database
   * @returns ISO 8601 formatted string, or empty string if date is null/undefined
   * @example
   * DateMapper.toNotNullString(new Date()) // '2025-12-05T10:30:00.000Z'
   * DateMapper.toNotNullString(null) // ''
   */
  static toNotNullString(date: Date | null | undefined): string {
    return date?.toISOString() ?? '';
  }

  /**
   * Convert Date to ISO 8601 string or null
   * Use for deletedAt and other optional date fields
   *
   * @param date - Date object from database
   * @returns ISO 8601 formatted string, or null if date is null/undefined
   * @example
   * DateMapper.toNullableString(new Date()) // '2025-12-05T10:30:00.000Z'
   * DateMapper.toNullableString(null) // null
   */
  static toNullableString(date: Date | null | undefined): string | null {
    return date?.toISOString() ?? null;
  }
}
