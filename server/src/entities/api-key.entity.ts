import { UserEntity } from 'src/entities/user.entity';
import { Permission } from 'src/enum';
import {
  Column,
  ColumnIndex,
  CreateDateColumn,
  GeneratedColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Table,
  UpdateDateColumn,
} from 'src/schema.decorator';

@Table('api_keys')
export class APIKeyEntity {
  @PrimaryGeneratedColumn()
  id!: string;

  @Column()
  name!: string;

  @Column()
  key!: string;

  @Column({ type: 'uuid', nullable: false })
  userId!: string;

  @Column({ array: true, type: 'character varying' })
  permissions!: Permission[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ColumnIndex({ name: 'IDX_api_keys_update_id' })
  @GeneratedColumn({ version: 'v4' })
  updateId?: string;

  @ManyToOne(() => UserEntity, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  user!: UserEntity;
}
