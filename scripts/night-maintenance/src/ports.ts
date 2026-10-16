export interface StateStore {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
}

export interface RunControls {
  checkWrite(): Promise<void>;
  checkLoad(): Promise<void>;
  canWrite(): boolean;
  sleep(ms: number): Promise<void>;
  log(entry: Record<string, unknown>): void;
  dryRun: boolean;
}
