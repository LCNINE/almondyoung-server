import { CronOnce } from '@app/cron-once';
import { TenancyConfig, TENANT_HEADER } from '@app/tenancy';
import { Injectable, Logger } from '@nestjs/common';
import { urlEnv } from '../platform/env';
import { UploadedFileRepository } from './uploaded-file.repository';

/**
 * 올린 뒤 이만큼 지나도 상품에 안 붙어 있으면 버린 것으로 본다.
 *
 * 어드민이 오늘 올려두고 다음 주에 등록을 마치는 일이 있으므로 짧게 잡지 않는다.
 */
const UNREFERENCED_AFTER_DAYS = 30;

/**
 * soft delete 뒤 S3 객체를 지우기까지 기다리는 기간. file-service 의
 * OBJECT_PURGE_GRACE_DAYS 보다 짧으면 매번 400 을 받으므로 하루 더 준다.
 */
const PURGE_AFTER_DAYS = 15;

/** 한 번에 처리할 건수. core 의 참조 조회 상한(500)과 짝이다. */
const BATCH_SIZE = 200;

/**
 * 어시스턴트가 올렸지만 상품에 붙지 못한 파일을 수거한다.
 *
 * upload_product_image 는 파일만 올린다. 어드민이 마음을 바꿔 등록을 안 하면 그 파일은
 * 아무 상품에도 연결되지 않고 S3 에 영구히 남는다 — 이 크론이 그걸 치운다.
 *
 * 어시스턴트가 올린 것만 본다. 다른 경로로 올라온 이미지는 추적 표에 없으므로 후보가
 * 되지 않는다.
 *
 * 테넌트 목록을 돌며 테넌트마다 그 테넌트의 행만 집어, core·file-service 에 그 테넌트 헤더를 붙여 묻는다.
 * 상품은 테넌트 DB 마다 따로라 다른 테넌트 core 에 물으면 «미참조»로 읽혀 살아 있는 파일을 지운다.
 * 목록 밖 테넌트의 행은 건드리지 않는다 — 어느 core 에 물을지 모른다.
 */
@Injectable()
export class OrphanFileReaperService {
  private readonly logger = new Logger(OrphanFileReaperService.name);

  constructor(
    private readonly repository: UploadedFileRepository,
    private readonly tenancy: TenancyConfig,
  ) {}

  @CronOnce('0 5 * * *', { name: 'assistant-orphan-file-reap', timeZone: 'Asia/Seoul' })
  async reap(): Promise<void> {
    // 한 테넌트의 실패는 그 테넌트에 갇힌다 — 다른 테넌트는 끝까지 돌고, 주기는 실패로 남긴다.
    const failed: string[] = [];
    for (const { id: tenant } of this.tenancy.tenants.entries) {
      try {
        const released = await this.releaseUnreferenced(tenant);
        const { purged, restored } = await this.purgeReleased(tenant);
        // 0건이어도 찍는다 — 크론이 도는지 보는 유일한 신호다.
        this.logger.log(`[OrphanFileReap] tenant=${tenant} soft-delete=${released} purge=${purged} restore=${restored}`);
      } catch (err) {
        failed.push(tenant);
        this.logger.error(`[OrphanFileReap] tenant=${tenant} 실패: ${(err as Error)?.message?.slice(0, 200)}`);
      }
    }

    // stuck 이 0 이 아니면 상품이 참조하는데 파일이 없는 건이 쌓인 것이다.
    const stuck = await this.repository.countStuck();
    this.logger.log(`[OrphanFileReap] stuck=${stuck}`);

    if (failed.length > 0) throw new Error(`[OrphanFileReap] 실패한 테넌트 tenant=${failed.join(',')}`);
  }

  /** 미참조 판정 → file-service 에 soft delete 요청. */
  private async releaseUnreferenced(tenant: string): Promise<number> {
    const cutoff = new Date(Date.now() - UNREFERENCED_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.repository.findUnchecked(tenant, cutoff, BATCH_SIZE);
    if (candidates.length === 0) return 0;

    const referenced = await this.fetchReferenced(tenant, candidates.map((row) => row.fileId));
    // 참조 조회가 실패하면 아무것도 지우지 않는다. 빈 배열을 "전부 미참조" 로 읽으면
    // core 가 잠깐 죽은 사이에 살아 있는 이미지를 지운다.
    if (referenced === null) {
      this.logger.warn('[OrphanFileReap] core 참조 조회 실패 — 이번 주기는 아무것도 지우지 않는다');
      return 0;
    }

    // 붙어 있는 것은 추적을 그만둔다. 한 번 붙은 파일이 나중에 떨어져도 그건
    // 상품을 고친 사람의 일이고, 어시스턴트가 뒤늦게 지울 근거는 못 된다.
    await this.repository.forget(candidates.filter((row) => referenced.has(row.fileId)).map((row) => row.fileId));

    const orphans = candidates.filter((row) => !referenced.has(row.fileId));
    const softDeleted: string[] = [];
    for (const orphan of orphans) {
      if ((await this.callFileService(tenant, orphan.fileId, '')) === 'ok') softDeleted.push(orphan.fileId);
    }
    await this.repository.markReleased(softDeleted);
    return softDeleted.length;
  }

  /**
   * 유예가 지난 soft delete 를 S3 객체까지 지운다.
   *
   * 지우기 직전에 참조를 다시 확인한다. soft delete 된 뒤에도 그 fileId 는 대화에
   * 남아 있어 어드민이 유예 중에 상품에 붙일 수 있다 — 그걸 그대로 지우면 상품
   * 이미지가 영구히 깨진다. 다시 쓰이게 된 파일은 지우지 말고 되살린다.
   */
  private async purgeReleased(tenant: string): Promise<{ purged: number; restored: number }> {
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const due = await this.repository.findReleasedBefore(tenant, cutoff, BATCH_SIZE);
    if (due.length === 0) return { purged: 0, restored: 0 };

    const referenced = await this.fetchReferenced(tenant, due.map((row) => row.fileId));
    if (referenced === null) {
      this.logger.warn('[OrphanFileReap] core 재확인 실패 — 이번 주기는 아무것도 지우지 않는다');
      return { purged: 0, restored: 0 };
    }

    const restored: string[] = [];
    const purged: string[] = [];
    const stuck: string[] = [];
    for (const row of due) {
      if (referenced.has(row.fileId)) {
        const result = await this.callFileService(tenant, row.fileId, '/restore', 'POST');
        if (result === 'ok') restored.push(row.fileId);
        if (result === 'stuck') stuck.push(row.fileId);
        continue;
      }
      if ((await this.callFileService(tenant, row.fileId, '/object')) === 'ok') purged.push(row.fileId);
    }

    await this.repository.forget([...purged, ...restored]);
    // 되살릴 수 없는 행은 큐에서 뺀다. 남겨 두면 매 주기 배치 앞자리를 차지해
    // 정작 지워야 할 파일이 영원히 밀린다.
    await this.repository.markStuck(stuck);
    return { purged: purged.length, restored: restored.length };
  }

  /**
   * 그 테넌트의 core 에 참조 여부를 묻는다(core 내부 키 가드는 테넌트 헤더로 DB 를 고른다).
   * 실패는 null 이다 — 빈 집합과 구별되어야 한다.
   */
  private async fetchReferenced(tenant: string, fileIds: string[]): Promise<Set<string> | null> {
    const key = process.env.CORE_INTERNAL_KEY;
    if (!key) {
      this.logger.error('[OrphanFileReap] CORE_INTERNAL_KEY 가 없다');
      return null;
    }

    const url = `${urlEnv('CORE_API_URL', 'http://localhost:3100')}/internal/product-files/referenced?fileIds=${fileIds.join(',')}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, [TENANT_HEADER]: tenant } });
      if (!res.ok) {
        this.logger.error(`[OrphanFileReap] 참조 조회 ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { referenced?: unknown };
      if (!Array.isArray(body.referenced)) return null;
      return new Set(body.referenced.filter((id): id is string => typeof id === 'string'));
    } catch (err) {
      this.logger.error(`[OrphanFileReap] 참조 조회 실패: ${(err as Error)?.message?.slice(0, 200)}`);
      return null;
    }
  }

  /**
   * file-service 의 내부 라우트. 빈 suffix 는 soft delete, `/object` 는 실삭제, `/restore` 는 복구.
   * 테넌트 헤더를 싣는다 — file-service 내부 키 라우트는 헤더 테넌트의 파일만 본다(다른 테넌트 파일은 404).
   *
   * `retry` 는 다음 주기에 다시 해 볼 실패, `stuck` 은 자동으로는 더 못 고치는 상태다.
   */
  private async callFileService(
    tenant: string,
    fileId: string,
    suffix: '' | '/object' | '/restore',
    method: 'DELETE' | 'POST' = 'DELETE',
  ): Promise<'ok' | 'retry' | 'stuck'> {
    const key = process.env.FILE_SERVICE_INTERNAL_KEY;
    if (!key) {
      this.logger.error('[OrphanFileReap] FILE_SERVICE_INTERNAL_KEY 가 없다');
      return 'retry';
    }

    const base = urlEnv('FILE_SERVICE_URL', 'http://localhost:3010');
    try {
      const res = await fetch(`${base}/internal/files/${fileId}${suffix}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, [TENANT_HEADER]: tenant },
      });
      if (res.status === 404) {
        // 복구하려는데 행이 없다 = 상품이 참조하는 파일이 이미 사라졌다. 다시 해도
        // 같으므로 stuck 으로 빼고 기록만 남긴다.
        if (suffix === '/restore') {
          this.logger.error(`[OrphanFileReap] 상품이 참조하는 파일이 이미 없다 — 수동 확인 필요 fileId=${fileId}`);
          return 'stuck';
        }
        // 지우려는데 행이 없으면 지울 것도 추적할 것도 없다.
        return 'ok';
      }
      if (!res.ok) {
        this.logger.warn(`[OrphanFileReap] ${method}${suffix} 실패 fileId=${fileId} status=${res.status}`);
        return 'retry';
      }
      return 'ok';
    } catch (err) {
      this.logger.warn(`[OrphanFileReap] 요청 실패 fileId=${fileId}: ${(err as Error)?.message?.slice(0, 200)}`);
      return 'retry';
    }
  }
}
