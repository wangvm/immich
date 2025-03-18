import { ExpressionBuilder } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { DB } from 'src/db';
import { AssetEntity } from 'src/entities/asset.entity';
import { TagEntity } from 'src/entities/tag.entity';
import { UserMetadataEntity } from 'src/entities/user-metadata.entity';
import { UserStatus } from 'src/enum';
import {
  Column,
  ColumnIndex,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
  Table,
  UpdateDateColumn,
} from 'src/schema.decorator';

@Table('users')
@Index({ name: 'IDX_users_updated_at_asc_id_asc', columns: ['updatedAt', 'id'] })
export class UserEntity {
  @Column({ primary: true, type: 'uuid', default: 'uuid_generate_v4()' })
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'boolean', default: false })
  isAdmin!: boolean;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: true, nullable: true, default: null })
  storageLabel!: string | null;

  @Column({ default: '' })
  password?: string;

  @Column({ default: '' })
  oauthId!: string;

  @Column({ default: '' })
  profileImagePath!: string;

  @Column({ type: 'boolean', default: true })
  shouldChangePassword!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  @Column({ type: 'character varying', default: UserStatus.ACTIVE })
  status!: UserStatus;

  @ColumnIndex({ name: 'IDX_users_update_id' })
  @Column({ type: 'uuid', default: `immich_uuid_v7()` })
  updateId?: string;

  @Column({ type: 'bigint', nullable: true })
  quotaSizeInBytes!: number | null;

  @Column({ type: 'bigint', default: 0 })
  quotaUsageInBytes!: number;

  @Column({ type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' })
  profileChangedAt!: Date;

  tags!: TagEntity[];
  assets!: AssetEntity[];
  metadata!: UserMetadataEntity[];
}

export const withMetadata = (eb: ExpressionBuilder<DB, 'users'>) => {
  return jsonArrayFrom(
    eb.selectFrom('user_metadata').selectAll('user_metadata').whereRef('users.id', '=', 'user_metadata.userId'),
  ).as('metadata');
};
