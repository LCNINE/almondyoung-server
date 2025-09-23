// apps/notification/src/campaign/services/user-search.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { sql, and, or, ilike } from 'drizzle-orm';
import { userProfiles } from '../../../database/schemas/notification-schema';

@Injectable()
export class UserSearchService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async searchUsers(criteria: any): Promise<string[]> {
        const conditions: any[] = [];

        if (criteria.email) {
            conditions.push(ilike(userProfiles.email, `%${criteria.email}%`));
        }

        if (criteria.phoneNumber) {
            conditions.push(ilike(userProfiles.phoneNumber, `%${criteria.phoneNumber}%`));
        }

        if (criteria.membershipTypes?.length > 0) {
            conditions.push(
                sql`${userProfiles.membershipType} = ANY(${criteria.membershipTypes})`
            );
        }

        if (criteria.shopCategories?.length > 0) {
            conditions.push(
                sql`${userProfiles.shopCategories} ?| ARRAY[${sql.join(
                    criteria.shopCategories,
                    sql`, `
                )}]`
            );
        }

        const users = await this.db.query.userProfiles.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            columns: { userId: true },
            limit: criteria.limit || 1000,
        });

        return users.map(u => u.userId);
    }
}