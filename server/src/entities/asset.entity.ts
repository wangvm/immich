import { DeduplicateJoinsPlugin, ExpressionBuilder, Kysely, SelectQueryBuilder, sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { DB } from 'src/db';
import { LibraryEntity } from 'src/entities/library.entity';
import { UserEntity } from 'src/entities/user.entity';
import { AssetFileType, AssetStatus, AssetType } from 'src/enum';
import { TimeBucketSize } from 'src/repositories/asset.repository';
import { AssetSearchBuilderOptions } from 'src/repositories/search.repository';
import {
  Column,
  ColumnIndex,
  CreateDateColumn,
  DeleteDateColumn,
  GeneratedColumn,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Table,
  UpdateDateColumn,
} from 'src/schema.decorator';
import { anyUuid, asUuid } from 'src/utils/database';

export const ASSET_CHECKSUM_CONSTRAINT = 'UQ_assets_owner_checksum';

@Table('assets')
// Checksums must be unique per user and library
@Index({
  name: ASSET_CHECKSUM_CONSTRAINT,
  columns: ['ownerId', 'checksum'],
  unique: true,
  where: '("libraryId" IS NULL)',
})
@Index({
  name: 'UQ_assets_owner_library_checksum' + '',
  columns: ['ownerId', 'libraryId', 'checksum'],
  unique: true,
  where: '("libraryId" IS NOT NULL)',
})
@Index({ name: 'idx_local_date_time', expression: `(("localDateTime" AT TIME ZONE 'UTC'::text))::date` })
@Index({
  name: 'idx_local_date_time_month',
  expression: `(date_trunc('MONTH'::text, ("localDateTime" AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text)`,
})
@Index({ name: 'IDX_originalPath_libraryId', columns: ['originalPath', 'libraryId'] })
@Index({ name: 'IDX_asset_id_stackId', columns: ['id', 'stackId'] })
@Index({
  name: 'idx_originalFileName_trigram',
  using: 'gin',
  expression: 'f_unaccent(("originalFileName")::text)',
})
// For all assets, each originalpath must be unique per user and library
export class AssetEntity {
  @PrimaryGeneratedColumn()
  id!: string;

  @Column()
  deviceAssetId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  owner!: UserEntity;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => LibraryEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  library?: LibraryEntity | null;

  @Column({ type: 'uuid', nullable: true })
  libraryId?: string | null;

  @Column()
  deviceId!: string;

  @Column()
  type!: AssetType;

  @Column({ type: 'enum', enum: AssetStatus, default: AssetStatus.ACTIVE })
  status!: AssetStatus;

  @Column()
  originalPath!: string;

  // @OneToMany(() => AssetFileEntity, (assetFile) => assetFile.asset)
  // files!: AssetFileEntity[];

  @Column({ type: 'bytea', nullable: true })
  thumbhash!: Buffer | null;

  @Column({ type: 'character varying', nullable: true, default: '' })
  encodedVideoPath!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ColumnIndex('IDX_assets_update_id')
  @GeneratedColumn({ version: 'v7' })
  updateId?: string;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  @ColumnIndex('idx_asset_file_created_at')
  @Column({ type: 'timestamp with time zone', default: null })
  fileCreatedAt!: Date;

  @Column({ type: 'timestamp with time zone', default: null })
  localDateTime!: Date;

  @Column({ type: 'timestamp with time zone', default: null })
  fileModifiedAt!: Date;

  @Column({ type: 'boolean', default: false })
  isFavorite!: boolean;

  @Column({ type: 'boolean', default: false })
  isArchived!: boolean;

  @Column({ type: 'boolean', default: false })
  isExternal!: boolean;

  @Column({ type: 'boolean', default: false })
  isOffline!: boolean;

  @Column({ type: 'bytea' })
  @ColumnIndex()
  checksum!: Buffer; // sha1 checksum

  @Column({ type: 'character varying', nullable: true })
  duration!: string | null;

  @Column({ type: 'boolean', default: true })
  isVisible!: boolean;

  // @ManyToOne(() => AssetEntity, { nullable: true, onUpdate: 'CASCADE', onDelete: 'SET NULL' })
  // @JoinColumn()
  // livePhotoVideo!: AssetEntity | null;

  @Column({ type: 'uuid', nullable: true })
  livePhotoVideoId!: string | null;

  @Column()
  @ColumnIndex()
  originalFileName!: string;

  @Column({ nullable: true })
  sidecarPath!: string | null;

  // @OneToOne(() => ExifEntity, (exifEntity) => exifEntity.asset)
  // exifInfo?: ExifEntity;

  // @OneToOne(() => SmartSearchEntity, (smartSearchEntity) => smartSearchEntity.asset)
  // smartSearch?: SmartSearchEntity;

  // @ManyToMany(() => TagEntity, (tag) => tag.assets, { cascade: true })
  // @JoinTable({ name: 'tag_asset', synchronize: false })
  // tags!: TagEntity[];

  // @ManyToMany(() => SharedLinkEntity, (link) => link.assets, { cascade: true })
  // @JoinTable({ name: 'shared_link__asset' })
  // sharedLinks!: SharedLinkEntity[];

  // @ManyToMany(() => AlbumEntity, (album) => album.assets, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  // albums?: AlbumEntity[];

  // @OneToMany(() => AssetFaceEntity, (assetFace) => assetFace.asset)
  // faces!: AssetFaceEntity[];

  @Column({ type: 'uuid', nullable: true })
  stackId?: string | null;

  // @ManyToOne(() => StackEntity, { nullable: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  // @JoinColumn()
  // stack?: StackEntity | null;

  // @OneToOne(() => AssetJobStatusEntity, (jobStatus) => jobStatus.asset, { nullable: true })
  // jobStatus?: AssetJobStatusEntity;

  @ColumnIndex('IDX_assets_duplicateId')
  @Column({ type: 'uuid', nullable: true })
  duplicateId!: string | null;
}

export type AssetEntityPlaceholder = AssetEntity & {
  fileCreatedAt: Date | null;
  fileModifiedAt: Date | null;
  localDateTime: Date | null;
};

export function withExif<O>(qb: SelectQueryBuilder<DB, 'assets', O>) {
  return qb.leftJoin('exif', 'assets.id', 'exif.assetId').select((eb) => eb.fn.toJson(eb.table('exif')).as('exifInfo'));
}

export function withExifInner<O>(qb: SelectQueryBuilder<DB, 'assets', O>) {
  return qb
    .innerJoin('exif', 'assets.id', 'exif.assetId')
    .select((eb) => eb.fn.toJson(eb.table('exif')).as('exifInfo'));
}

export function withSmartSearch<O>(qb: SelectQueryBuilder<DB, 'assets', O>) {
  return qb
    .leftJoin('smart_search', 'assets.id', 'smart_search.assetId')
    .select((eb) => eb.fn.toJson(eb.table('smart_search')).as('smartSearch'));
}

export function withFaces(eb: ExpressionBuilder<DB, 'assets'>, withDeletedFace?: boolean) {
  return jsonArrayFrom(
    eb
      .selectFrom('asset_faces')
      .selectAll()
      .whereRef('asset_faces.assetId', '=', 'assets.id')
      .$if(!withDeletedFace, (qb) => qb.where('asset_faces.deletedAt', 'is', null)),
  ).as('faces');
}

export function withFiles(eb: ExpressionBuilder<DB, 'assets'>, type?: AssetFileType) {
  return jsonArrayFrom(
    eb
      .selectFrom('asset_files')
      .selectAll()
      .whereRef('asset_files.assetId', '=', 'assets.id')
      .$if(!!type, (qb) => qb.where('type', '=', type!)),
  ).as('files');
}

export function withFacesAndPeople(eb: ExpressionBuilder<DB, 'assets'>, withDeletedFace?: boolean) {
  return eb
    .selectFrom('asset_faces')
    .leftJoin('person', 'person.id', 'asset_faces.personId')
    .whereRef('asset_faces.assetId', '=', 'assets.id')
    .$if(!withDeletedFace, (qb) => qb.where('asset_faces.deletedAt', 'is', null))
    .select((eb) =>
      eb
        .fn('jsonb_agg', [
          eb
            .case()
            .when('person.id', 'is not', null)
            .then(
              eb.fn('jsonb_insert', [
                eb.fn('to_jsonb', [eb.table('asset_faces')]),
                sql`'{person}'::text[]`,
                eb.fn('to_jsonb', [eb.table('person')]),
              ]),
            )
            .else(eb.fn('to_jsonb', [eb.table('asset_faces')]))
            .end(),
        ])
        .as('faces'),
    )
    .as('faces');
}

export function hasPeople<O>(qb: SelectQueryBuilder<DB, 'assets', O>, personIds: string[]) {
  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_faces')
        .select('assetId')
        .where('personId', '=', anyUuid(personIds!))
        .where('deletedAt', 'is', null)
        .groupBy('assetId')
        .having((eb) => eb.fn.count('personId').distinct(), '=', personIds.length)
        .as('has_people'),
    (join) => join.onRef('has_people.assetId', '=', 'assets.id'),
  );
}

export function hasTags<O>(qb: SelectQueryBuilder<DB, 'assets', O>, tagIds: string[]) {
  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('tag_asset')
        .select('assetsId')
        .innerJoin('tags_closure', 'tag_asset.tagsId', 'tags_closure.id_descendant')
        .where('tags_closure.id_ancestor', '=', anyUuid(tagIds))
        .groupBy('assetsId')
        .having((eb) => eb.fn.count('tags_closure.id_ancestor').distinct(), '>=', tagIds.length)
        .as('has_tags'),
    (join) => join.onRef('has_tags.assetsId', '=', 'assets.id'),
  );
}

export function withOwner(eb: ExpressionBuilder<DB, 'assets'>) {
  return jsonObjectFrom(eb.selectFrom('users').selectAll().whereRef('users.id', '=', 'assets.ownerId')).as('owner');
}

export function withLibrary(eb: ExpressionBuilder<DB, 'assets'>) {
  return jsonObjectFrom(eb.selectFrom('libraries').selectAll().whereRef('libraries.id', '=', 'assets.libraryId')).as(
    'library',
  );
}

export function withAlbums<O>(qb: SelectQueryBuilder<DB, 'assets', O>, { albumId }: { albumId?: string }) {
  return qb
    .select((eb) =>
      jsonArrayFrom(
        eb
          .selectFrom('albums')
          .selectAll()
          .innerJoin('albums_assets_assets', (join) =>
            join
              .onRef('albums.id', '=', 'albums_assets_assets.albumsId')
              .onRef('assets.id', '=', 'albums_assets_assets.assetsId'),
          )
          .whereRef('albums.id', '=', 'albums_assets_assets.albumsId')
          .$if(!!albumId, (qb) => qb.where('albums.id', '=', asUuid(albumId!))),
      ).as('albums'),
    )
    .$if(!!albumId, (qb) =>
      qb.where((eb) =>
        eb.exists((eb) =>
          eb
            .selectFrom('albums_assets_assets')
            .whereRef('albums_assets_assets.assetsId', '=', 'assets.id')
            .where('albums_assets_assets.albumsId', '=', asUuid(albumId!)),
        ),
      ),
    );
}

export function withTags(eb: ExpressionBuilder<DB, 'assets'>) {
  return jsonArrayFrom(
    eb
      .selectFrom('tags')
      .selectAll('tags')
      .innerJoin('tag_asset', 'tags.id', 'tag_asset.tagsId')
      .whereRef('assets.id', '=', 'tag_asset.assetsId'),
  ).as('tags');
}

export function truncatedDate<O>(size: TimeBucketSize) {
  return sql<O>`date_trunc(${size}, "localDateTime" at time zone 'UTC') at time zone 'UTC'`;
}

export function withTagId<O>(qb: SelectQueryBuilder<DB, 'assets', O>, tagId: string) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('tags_closure')
        .innerJoin('tag_asset', 'tag_asset.tagsId', 'tags_closure.id_descendant')
        .whereRef('tag_asset.assetsId', '=', 'assets.id')
        .where('tags_closure.id_ancestor', '=', tagId),
    ),
  );
}

const joinDeduplicationPlugin = new DeduplicateJoinsPlugin();

/** TODO: This should only be used for search-related queries, not as a general purpose query builder */
export function searchAssetBuilder(kysely: Kysely<DB>, options: AssetSearchBuilderOptions) {
  options.isArchived ??= options.withArchived ? undefined : false;
  options.withDeleted ||= !!(options.trashedAfter || options.trashedBefore || options.isOffline);
  return kysely
    .withPlugin(joinDeduplicationPlugin)
    .selectFrom('assets')
    .selectAll('assets')
    .$if(!!options.tagIds && options.tagIds.length > 0, (qb) => hasTags(qb, options.tagIds!))
    .$if(!!options.personIds && options.personIds.length > 0, (qb) => hasPeople(qb, options.personIds!))
    .$if(!!options.createdBefore, (qb) => qb.where('assets.createdAt', '<=', options.createdBefore!))
    .$if(!!options.createdAfter, (qb) => qb.where('assets.createdAt', '>=', options.createdAfter!))
    .$if(!!options.updatedBefore, (qb) => qb.where('assets.updatedAt', '<=', options.updatedBefore!))
    .$if(!!options.updatedAfter, (qb) => qb.where('assets.updatedAt', '>=', options.updatedAfter!))
    .$if(!!options.trashedBefore, (qb) => qb.where('assets.deletedAt', '<=', options.trashedBefore!))
    .$if(!!options.trashedAfter, (qb) => qb.where('assets.deletedAt', '>=', options.trashedAfter!))
    .$if(!!options.takenBefore, (qb) => qb.where('assets.fileCreatedAt', '<=', options.takenBefore!))
    .$if(!!options.takenAfter, (qb) => qb.where('assets.fileCreatedAt', '>=', options.takenAfter!))
    .$if(options.city !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.city', options.city === null ? 'is' : '=', options.city!),
    )
    .$if(options.state !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.state', options.state === null ? 'is' : '=', options.state!),
    )
    .$if(options.country !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.country', options.country === null ? 'is' : '=', options.country!),
    )
    .$if(options.make !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.make', options.make === null ? 'is' : '=', options.make!),
    )
    .$if(options.model !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.model', options.model === null ? 'is' : '=', options.model!),
    )
    .$if(options.lensModel !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.lensModel', options.lensModel === null ? 'is' : '=', options.lensModel!),
    )
    .$if(options.rating !== undefined, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where('exif.rating', options.rating === null ? 'is' : '=', options.rating!),
    )
    .$if(!!options.checksum, (qb) => qb.where('assets.checksum', '=', options.checksum!))
    .$if(!!options.deviceAssetId, (qb) => qb.where('assets.deviceAssetId', '=', options.deviceAssetId!))
    .$if(!!options.deviceId, (qb) => qb.where('assets.deviceId', '=', options.deviceId!))
    .$if(!!options.id, (qb) => qb.where('assets.id', '=', asUuid(options.id!)))
    .$if(!!options.libraryId, (qb) => qb.where('assets.libraryId', '=', asUuid(options.libraryId!)))
    .$if(!!options.userIds, (qb) => qb.where('assets.ownerId', '=', anyUuid(options.userIds!)))
    .$if(!!options.encodedVideoPath, (qb) => qb.where('assets.encodedVideoPath', '=', options.encodedVideoPath!))
    .$if(!!options.originalPath, (qb) =>
      qb.where(sql`f_unaccent(assets."originalPath")`, 'ilike', sql`'%' || f_unaccent(${options.originalPath}) || '%'`),
    )
    .$if(!!options.originalFileName, (qb) =>
      qb.where(
        sql`f_unaccent(assets."originalFileName")`,
        'ilike',
        sql`'%' || f_unaccent(${options.originalFileName}) || '%'`,
      ),
    )
    .$if(!!options.description, (qb) =>
      qb
        .innerJoin('exif', 'assets.id', 'exif.assetId')
        .where(sql`f_unaccent(exif.description)`, 'ilike', sql`'%' || f_unaccent(${options.description}) || '%'`),
    )
    .$if(!!options.type, (qb) => qb.where('assets.type', '=', options.type!))
    .$if(options.isFavorite !== undefined, (qb) => qb.where('assets.isFavorite', '=', options.isFavorite!))
    .$if(options.isOffline !== undefined, (qb) => qb.where('assets.isOffline', '=', options.isOffline!))
    .$if(options.isVisible !== undefined, (qb) => qb.where('assets.isVisible', '=', options.isVisible!))
    .$if(options.isArchived !== undefined, (qb) => qb.where('assets.isArchived', '=', options.isArchived!))
    .$if(options.isEncoded !== undefined, (qb) =>
      qb.where('assets.encodedVideoPath', options.isEncoded ? 'is not' : 'is', null),
    )
    .$if(options.isMotion !== undefined, (qb) =>
      qb.where('assets.livePhotoVideoId', options.isMotion ? 'is not' : 'is', null),
    )
    .$if(!!options.isNotInAlbum, (qb) =>
      qb.where((eb) =>
        eb.not(eb.exists((eb) => eb.selectFrom('albums_assets_assets').whereRef('assetsId', '=', 'assets.id'))),
      ),
    )
    .$if(!!options.withExif, withExifInner)
    .$if(!!(options.withFaces || options.withPeople || options.personIds), (qb) => qb.select(withFacesAndPeople))
    .$if(!options.withDeleted, (qb) => qb.where('assets.deletedAt', 'is', null))
    .where('assets.fileCreatedAt', 'is not', null)
    .where('assets.fileModifiedAt', 'is not', null)
    .where('assets.localDateTime', 'is not', null);
}
