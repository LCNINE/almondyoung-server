import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productAuditLog } from '../schema';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, ip, headers } = request;

    // Only log mutations (POST, PUT, PATCH, DELETE)
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip audit log for certain endpoints
    if (url.includes('/bulk-import') || url.includes('/export')) {
      return next.handle();
    }

    const userId = body.userId || headers['x-user-id'] || 'system';
    const userEmail = headers['x-user-email'] || 'unknown';
    const productId = request.params.id || body.productId;

    return next.handle().pipe(
      tap(async (response) => {
        if (productId && userId) {
          try {
            await this.db.insert(productAuditLog).values({
              productId,
              action: this.mapMethodToAction(method, url),
              changes: this.sanitizeChanges(body),
              userId,
              userEmail,
              ipAddress: ip,
              userAgent: headers['user-agent'] || 'unknown',
            });
          } catch (error) {
            // Log error but don't fail the request
            console.error('Failed to log audit entry:', error);
          }
        }
      }),
    );
  }

  private mapMethodToAction(method: string, url: string): string {
    if (url.includes('/restore')) return 'restored';
    if (url.includes('/approve')) return 'approved';
    if (url.includes('/reject')) return 'rejected';

    const actionMap: Record<string, string> = {
      POST: 'created',
      PUT: 'updated',
      PATCH: 'updated',
      DELETE: 'deleted',
    };
    return actionMap[method] || 'unknown';
  }

  private sanitizeChanges(body: any): Record<string, any> {
    // Remove sensitive or unnecessary fields
    const { userId, password, token, ...changes } = body;
    return changes;
  }
}

