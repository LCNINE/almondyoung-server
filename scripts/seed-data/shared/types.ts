/**
 * Shared type definitions for seed data script
 */

export interface SeedResult {
  service: string;
  success: boolean;
  duration: number;
  error?: string;
}

export interface SeedReport {
  totalDuration: number;
  results: SeedResult[];
  successCount: number;
  failureCount: number;
}

export interface SeederFunction {
  (databaseUrl: string, ...args: any[]): Promise<void>;
}
