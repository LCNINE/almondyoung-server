import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorageService } from '../storage/storage.service';
import { FileRepository } from '../shared/repositories/file.repository';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly fileRepository: FileRepository,
  ) {}

  @Cron('0 2 * * *')
  async cleanupOrphanedFiles() {
    this.logger.log('Starting orphaned files cleanup...');
    
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphaned = await this.fileRepository.findPendingOlderThan(cutoffDate);

    this.logger.log(`Found ${orphaned.length} orphaned files to cleanup`);

    let successCount = 0;
    let errorCount = 0;

    for (const file of orphaned) {
      try {
        await this.storageService.delete({ key: file.filePath });
        await this.fileRepository.hardDelete(file.id);
        successCount++;
        this.logger.log(`Deleted orphaned file: ${file.id}`);
      } catch (error) {
        errorCount++;
        this.logger.error(`Failed to delete orphaned file ${file.id}:`, error);
      }
    }

    this.logger.log(
      `Orphaned files cleanup completed. Success: ${successCount}, Errors: ${errorCount}`,
    );
  }
}

