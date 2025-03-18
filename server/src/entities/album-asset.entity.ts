import { AlbumEntity } from 'src/entities/album.entity';
import { AssetEntity } from 'src/entities/asset.entity';
import { CreateDateColumn, ManyToOne, PrimaryColumn, Table } from 'src/schema.decorator';

@Table('albums_assets_assets')
export class AlbumAssetEntity {
  @PrimaryColumn({ type: 'uuid' })
  assetsId!: string;

  @PrimaryColumn({ type: 'uuid' })
  albumsId!: string;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  assets!: AssetEntity;

  @ManyToOne(() => AlbumEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  albums!: AlbumEntity;

  @CreateDateColumn()
  createdAt!: Date;
}
