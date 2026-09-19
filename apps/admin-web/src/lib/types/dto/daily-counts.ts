export interface DailyCountsDto {
  range: { from: string; to: string };
  series: Array<{ bucket: string; count: number }>;
}
