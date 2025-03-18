import { AssetOrder } from 'src/enum';
import {
  Column,
  ColumnIndex,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  Table,
  UpdateDateColumn,
} from 'src/schema.decorator';

@Table('albums')
export class AlbumEntity {
  @PrimaryGeneratedColumn()
  id!: string;

  // @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  // owner!: UserEntity;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ default: 'Untitled Album' })
  albumName!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ColumnIndex('IDX_albums_update_id')
  @Column({ type: 'uuid', nullable: false, default: () => 'immich_uuid_v7()' })
  updateId?: string;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  // @ManyToOne(() => AssetEntity, { nullable: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  // albumThumbnailAsset!: AssetEntity | null;

  @Column({ type: 'uuid', nullable: true })
  albumThumbnailAssetId!: string | null;

  // @OneToMany(() => AlbumUserEntity, ({ album }) => album, { cascade: true, onDelete: 'CASCADE' })
  // albumUsers!: AlbumUserEntity[];

  // @OneToMany(() => AlbumUserEntity, ({ album }) => album, { cascade: true, onDelete: 'CASCADE' })
  // albumUsers!: AlbumUserEntity[];

  // @ManyToMany(() => AssetEntity, (asset) => asset.albums)
  // @JoinTable({ synchronize: false })
  // assets!: AssetEntity[];

  // @OneToMany(() => SharedLinkEntity, (link) => link.album)
  // sharedLinks!: SharedLinkEntity[];

  @Column({ type: 'boolean', default: true })
  isActivityEnabled!: boolean;

  @Column({ default: AssetOrder.DESC })
  order!: AssetOrder;
}
