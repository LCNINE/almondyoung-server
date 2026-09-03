import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import type { ArchiveSpace } from './schema/archive.schema';
import type { ArchiveTx } from './archive.types';
import { ArchiveManager } from './archive.manager';
import { ArchiveReader } from './archive.reader';
import { ArchiveMapper } from './mappers/archive.mapper';
import {
  ArchivePageDetailDto,
  ArchivePageNodeDto,
  ArchivePageSaveResultDto,
  ArchivePageVersionDetailDto,
  ArchivePageVersionDto,
  ArchiveSearchResultDto,
  ArchiveTrashItemDto,
  CreateArchivePageDto,
  MoveArchivePageDto,
  UpdateArchivePageDto,
} from './dto/archive-page.dto';

const SEARCH_RESULT_LIMIT = 30;
const RECENT_LIMIT = 15;
const VERSION_LIST_LIMIT = 50;

@Injectable()
export class ArchiveService {
  constructor(
    private readonly reader: ArchiveReader,
    private readonly manager: ArchiveManager,
  ) {}

  async listTree(space: ArchiveSpace, actorId: string, tx?: ArchiveTx): Promise<ArchivePageNodeDto[]> {
    return ArchiveMapper.toNodes(await this.reader.listSpaceNodes(space, actorId, tx));
  }

  async getPage(id: string, actorId: string, tx?: ArchiveTx): Promise<ArchivePageDetailDto> {
    const page = await this.reader.findAccessibleOrThrow(id, actorId, {}, tx);
    const isFavorite = await this.reader.isFavorite(id, actorId, tx);
    const ancestors = await this.reader.listAncestors(page, actorId, tx);

    return ArchiveMapper.toDetail(page, isFavorite, ArchiveMapper.toBreadcrumbRows(ancestors));
  }

  async create(dto: CreateArchivePageDto, actorId: string, tx?: ArchiveTx): Promise<ArchivePageDetailDto> {
    const page = await this.manager.create(dto, actorId, tx);
    const ancestors = await this.reader.listAncestors(page, actorId, tx);
    return ArchiveMapper.toDetail(page, false, ArchiveMapper.toBreadcrumbRows(ancestors));
  }

  /** 자동 저장 경로 — 여기서 조상까지 다시 읽으면 타이핑마다 조회가 붙는다. */
  async update(
    id: string,
    dto: UpdateArchivePageDto,
    actorId: string,
    tx?: ArchiveTx,
  ): Promise<ArchivePageSaveResultDto> {
    return ArchiveMapper.toSaveResult(await this.manager.update(id, dto, actorId, tx));
  }

  async move(id: string, dto: MoveArchivePageDto, actorId: string, tx?: ArchiveTx): Promise<ArchivePageNodeDto[]> {
    const page = await this.manager.move(id, dto, actorId, tx);
    return this.listTree(page.space, actorId, tx);
  }

  async remove(id: string, actorId: string, tx?: ArchiveTx): Promise<{ removedIds: string[] }> {
    return { removedIds: await this.manager.remove(id, actorId, tx) };
  }

  async restore(id: string, actorId: string, tx?: ArchiveTx): Promise<ArchivePageDetailDto> {
    const page = await this.manager.restore(id, actorId, tx);
    const ancestors = await this.reader.listAncestors(page, actorId, tx);
    return ArchiveMapper.toDetail(page, false, ArchiveMapper.toBreadcrumbRows(ancestors));
  }

  async purge(id: string, actorId: string, tx?: ArchiveTx): Promise<{ purgedIds: string[] }> {
    return { purgedIds: await this.manager.purge(id, actorId, tx) };
  }

  async search(query: string, actorId: string, tx?: ArchiveTx): Promise<ArchiveSearchResultDto> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new BadRequestError('검색어는 두 글자 이상이어야 합니다.');
    }

    const [rows, index] = await Promise.all([
      this.reader.search(trimmed, actorId, SEARCH_RESULT_LIMIT, tx),
      this.reader.loadAncestryIndex(actorId, tx),
    ]);

    // 리더가 상한 + 1 건을 읽어 온다. 넘친 한 건은 «더 있다»는 신호로만 쓰고 버린다.
    const hasMore = rows.length > SEARCH_RESULT_LIMIT;
    const hits = hasMore ? rows.slice(0, SEARCH_RESULT_LIMIT) : rows;

    return {
      hits: ArchiveMapper.toSearchHits(hits, trimmed, index),
      hasMore,
      limit: SEARCH_RESULT_LIMIT,
    };
  }

  async listTrash(actorId: string, tx?: ArchiveTx): Promise<ArchiveTrashItemDto[]> {
    return ArchiveMapper.toTrashItems(await this.reader.listDeleted(actorId, tx));
  }

  async listFavorites(actorId: string, tx?: ArchiveTx): Promise<ArchivePageNodeDto[]> {
    return ArchiveMapper.toNodes(await this.reader.listFavorites(actorId, tx));
  }

  async setFavorite(id: string, actorId: string, favorite: boolean, tx?: ArchiveTx): Promise<{ isFavorite: boolean }> {
    return { isFavorite: await this.manager.setFavorite(id, actorId, favorite, tx) };
  }

  async listRecent(actorId: string, tx?: ArchiveTx): Promise<ArchivePageNodeDto[]> {
    return ArchiveMapper.toNodes(await this.reader.listRecent(actorId, RECENT_LIMIT, tx));
  }

  async listVersions(id: string, actorId: string, tx?: ArchiveTx): Promise<ArchivePageVersionDto[]> {
    await this.reader.findAccessibleOrThrow(id, actorId, {}, tx);
    const versions = await this.reader.listVersions(id, VERSION_LIST_LIMIT, tx);
    return versions.map((version) => ArchiveMapper.toVersion(version));
  }

  async getVersion(
    id: string,
    versionId: string,
    actorId: string,
    tx?: ArchiveTx,
  ): Promise<ArchivePageVersionDetailDto> {
    await this.reader.findAccessibleOrThrow(id, actorId, {}, tx);
    return ArchiveMapper.toVersionDetail(await this.reader.findVersionOrThrow(id, versionId, tx));
  }

  async restoreVersion(id: string, versionId: string, actorId: string, tx?: ArchiveTx): Promise<ArchivePageDetailDto> {
    const page = await this.manager.restoreVersion(id, versionId, actorId, tx);
    const isFavorite = await this.reader.isFavorite(id, actorId, tx);
    const ancestors = await this.reader.listAncestors(page, actorId, tx);
    return ArchiveMapper.toDetail(page, isFavorite, ArchiveMapper.toBreadcrumbRows(ancestors));
  }
}
