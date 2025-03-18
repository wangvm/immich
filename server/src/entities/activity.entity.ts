import { AlbumEntity } from 'src/entities/album.entity';
import { AssetEntity } from 'src/entities/asset.entity';
import { UserEntity } from 'src/entities/user.entity';
import {
  Column,
  ColumnIndex,
  CreateDateColumn,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Table,
  UpdateDateColumn,
} from 'src/schema.decorator';

@Table('activity')
@Index({
  name: 'IDX_activity_like',
  columns: ['assetId', 'userId', 'albumId'],
  unique: true,
  where: '("isLiked" = true)',
})
// @Check(`("comment" IS NULL AND "isLiked" = true) OR ("comment" IS NOT NULL AND "isLiked" = false)`)
export class ActivityEntity {
  @PrimaryGeneratedColumn()
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ColumnIndex('IDX_activity_update_id')
  @Column({ type: 'uuid', nullable: false, default: () => 'immich_uuid_v7()' })
  updateId!: string;

  @Column({ type: 'uuid' })
  albumId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  assetId!: string | null;

  @Column({ type: 'text', default: null })
  comment!: string | null;

  @Column({ type: 'boolean', default: false })
  isLiked!: boolean;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: true })
  asset!: AssetEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  user!: UserEntity;

  @ManyToOne(() => AlbumEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  album!: AlbumEntity;
}
