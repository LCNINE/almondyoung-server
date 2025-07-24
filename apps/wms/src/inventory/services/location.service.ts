import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';

@Injectable()
export class LocationService {
    private readonly logger = new Logger(LocationService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    // TODO: 최적 로케이션 찾기 메서드

    // TODO: FIFO 순위 관리 메서드

    // TODO: 로케이션 용량 관리 메서드

    // TODO: 로케이션 생성/수정/삭제 메서드

}