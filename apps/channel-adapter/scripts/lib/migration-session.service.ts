// apps/channel-adapter/scripts/lib/migration-session.service.ts
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrationProgress, migrationFailures, type ChannelAdapterSchema } from '../../src/schema';
import type { PimProductSnapshot } from '../../src/types';

export interface MigrationSession {
  id: string;
  sessionId: string;
  status: 'in_progress' | 'completed' | 'failed' | 'paused';
  startedAt: Date;
  completedAt: Date | null;
  totalMasters: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  batchSize: number;
  currentOffset: number;
  lastProcessedMasterId: string | null;
  lastError: string | null;
  errorStackTrace: string | null;
  updatedAt: Date | null;
}

export interface ProgressUpdate {
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  currentOffset: number;
  lastProcessedMasterId?: string;
}

export type ErrorType =
  | 'validation_error'
  | 'medusa_api_error'
  | 'network_error'
  | 'db_error'
  | 'unknown';

/**
 * MigrationSessionService - Manages migration progress tracking
 *
 * Provides checkpoint-based session management:
 * - Create new migration sessions
 * - Load existing sessions for resume
 * - Update progress after each batch
 * - Record failures with full context
 * - Mark sessions as complete/failed
 */
export class MigrationSessionService {
  constructor(private readonly db: PostgresJsDatabase<ChannelAdapterSchema>) {}

  /**
   * Create a new migration session
   */
  async createSession(batchSize: number = 100): Promise<MigrationSession> {
    const sessionId = `backfill-${Date.now()}-${uuidv4().slice(0, 8)}`;

    console.log(`[MigrationSession] Creating new session: ${sessionId}`);

    const [session] = await this.db
      .insert(migrationProgress)
      .values({
        sessionId,
        batchSize,
        status: 'in_progress',
      })
      .returning();

    return this.toSession(session);
  }

  /**
   * Load existing session by ID
   */
  async loadSession(sessionId: string): Promise<MigrationSession | null> {
    console.log(`[MigrationSession] Loading session: ${sessionId}`);

    const [session] = await this.db
      .select()
      .from(migrationProgress)
      .where(eq(migrationProgress.sessionId, sessionId));

    if (!session) {
      console.warn(`[MigrationSession] Session not found: ${sessionId}`);
      return null;
    }

    console.log(
      `[MigrationSession] Loaded session: ${session.processedCount}/${session.totalMasters} processed`
    );

    return this.toSession(session);
  }

  /**
   * Update session progress after batch processing
   */
  async updateProgress(
    sessionId: string,
    updates: ProgressUpdate
  ): Promise<void> {
    await this.db
      .update(migrationProgress)
      .set({
        processedCount: updates.processedCount,
        successCount: updates.successCount,
        failedCount: updates.failedCount,
        skippedCount: updates.skippedCount,
        currentOffset: updates.currentOffset,
        lastProcessedMasterId: updates.lastProcessedMasterId,
        updatedAt: new Date(),
      })
      .where(eq(migrationProgress.sessionId, sessionId));

    console.log(
      `[MigrationSession] Progress updated: ${updates.processedCount} processed, ${updates.successCount} success, ${updates.failedCount} failed`
    );
  }

  /**
   * Mark session as completed
   */
  async completeSession(sessionId: string): Promise<void> {
    console.log(`[MigrationSession] Completing session: ${sessionId}`);

    await this.db
      .update(migrationProgress)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(migrationProgress.sessionId, sessionId));
  }

  /**
   * Mark session as failed
   */
  async failSession(sessionId: string, error: Error): Promise<void> {
    console.error(`[MigrationSession] Session failed: ${sessionId}`, error);

    await this.db
      .update(migrationProgress)
      .set({
        status: 'failed',
        lastError: error.message,
        errorStackTrace: error.stack || null,
        updatedAt: new Date(),
      })
      .where(eq(migrationProgress.sessionId, sessionId));
  }

  /**
   * Record a product sync failure
   */
  async recordFailure(
    sessionId: string,
    masterId: string,
    versionId: string,
    error: Error,
    errorType: ErrorType,
    snapshot: PimProductSnapshot
  ): Promise<void> {
    await this.db.insert(migrationFailures).values({
      sessionId,
      masterId,
      versionId,
      errorType,
      errorMessage: error.message,
      stackTrace: error.stack || null,
      snapshot: snapshot as any,
    });

    console.error(
      `[MigrationSession] Failure recorded: ${masterId} (${errorType}): ${error.message}`
    );
  }

  /**
   * Get all unresolved failures for a session
   */
  async getUnresolvedFailures(sessionId: string): Promise<any[]> {
    return await this.db
      .select()
      .from(migrationFailures)
      .where(
        and(
          eq(migrationFailures.sessionId, sessionId),
          eq(migrationFailures.resolved, false)
        )
      );
  }

  /**
   * Mark a failure as resolved
   */
  async resolveFailure(failureId: string): Promise<void> {
    await this.db
      .update(migrationFailures)
      .set({
        resolved: true,
        lastRetryAt: new Date(),
      })
      .where(eq(migrationFailures.id, failureId));
  }

  /**
   * Increment retry count for a failure
   */
  async incrementRetryCount(failureId: string, error: Error): Promise<void> {
    const [failure] = await this.db
      .select()
      .from(migrationFailures)
      .where(eq(migrationFailures.id, failureId));

    if (!failure) return;

    await this.db
      .update(migrationFailures)
      .set({
        retryCount: failure.retryCount + 1,
        lastRetryAt: new Date(),
        errorMessage: error.message,
        stackTrace: error.stack || null,
      })
      .where(eq(migrationFailures.id, failureId));
  }

  /**
   * Convert database row to MigrationSession object
   */
  private toSession(row: any): MigrationSession {
    return {
      id: row.id,
      sessionId: row.sessionId,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      totalMasters: row.totalMasters,
      processedCount: row.processedCount,
      successCount: row.successCount,
      failedCount: row.failedCount,
      skippedCount: row.skippedCount,
      batchSize: row.batchSize,
      currentOffset: row.currentOffset,
      lastProcessedMasterId: row.lastProcessedMasterId,
      lastError: row.lastError,
      errorStackTrace: row.errorStackTrace,
      updatedAt: row.updatedAt,
    };
  }
}
