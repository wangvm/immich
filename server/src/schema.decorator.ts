/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import { createHash } from 'node:crypto';
import { DatabaseActionType, DatabaseConstraintType, DatabaseRelationType } from 'src/enum';
import {
  ColumnIndexOptions,
  ColumnOptions,
  DatabaseSchema,
  GenerateColumnOptions,
  IndexOptions,
  TableOptions,
} from 'src/types';

const asKey = (prefix: string, tableName: string, columnNames: string[]) => {
  return (prefix + sha1(`${tableName}_${columnNames.toSorted().join('_')}`)).slice(0, 30);
};

const asPrimaryKeyConstraintName = (tableName: string, columnNames: string[]) => asKey('PK_', tableName, columnNames);
const asUniqueConstraintName = (tableName: string, columnNames: string[]) => asKey('UQ_', tableName, columnNames);
const asForeignKeyConstraintName = (tableName: string, columnNames: string[]) => asKey('FK_', tableName, columnNames);

// match TypeORM
const sha1 = (value: string) => {
  return createHash('sha1').update(value).digest('hex');
};

let initialized = false;
const dynamicSchema: DatabaseSchema = {
  name: 'public',
  tables: [],
};

enum SchemaKey {
  TableName = 'immich-schema:table-name',
  ColumnName = 'immich-schema:column-name',
  IndexName = 'immich-schema:index-name',
}

type RegisterTable = { target: Function; options: TableOptions };
type RegisterColumn = { object: object; propertyName: string | symbol; options: ColumnOptions };
type RegisterIndex = { object: object; options: IndexOptions };
type RegisterColumnIndex = { object: object; propertyName: string | symbol; options: ColumnIndexOptions };
type RegisterRelation = {
  object: object;
  propertyName: string | symbol;
  options: RelationOptions;
  type: DatabaseRelationType;
  target: () => object;
};

const tables: RegisterTable[] = [];
const columns: RegisterColumn[] = [];
const indexes: RegisterIndex[] = [];
const columnIndexes: RegisterColumnIndex[] = [];
const relationOptions: RegisterRelation[] = [];

export const Table = (options: string | TableOptions = {}): ClassDecorator => {
  if (typeof options === 'string') {
    options = { name: options };
  }

  return (target: Function) => {
    tables.push({ target, options });
  };
};

export const Column = (options: ColumnOptions = {}): PropertyDecorator => {
  return (object: object, propertyName: string | symbol) => {
    columns.push({ object, propertyName, options });
  };
};

export const Index = (options: string | IndexOptions = {}) => {
  if (typeof options === 'string') {
    options = { name: options };
  }

  return (object: object) => {
    indexes.push({ object, options });
  };
};

export const ColumnIndex = (options: string | ColumnIndexOptions = {}) => {
  if (typeof options === 'string') {
    options = { name: options };
  }

  return (object: object, propertyName: string | symbol) => {
    columnIndexes.push({ object, propertyName, options });
  };
};

export const PrimaryGeneratedColumn = (options: Omit<GenerateColumnOptions, 'primary'> = {}) =>
  GeneratedColumn({ version: 'v4', ...options, primary: true });

export const PrimaryColumn = (options: Omit<ColumnOptions, 'primary'> = {}) => Column({ ...options, primary: true });

export const GeneratedColumn = ({ version, ...options }: GenerateColumnOptions): PropertyDecorator => {
  return Column({
    type: 'uuid',
    default: (version || 'v4') === 'v4' ? 'uuid_generate_v4()' : 'immich_uuid_v7()',
    ...options,
  });
};

export const CreateDateColumn = (options: ColumnOptions = {}): PropertyDecorator => {
  return Column({
    type: 'timestamp with time zone',
    default: 'now()',
    ...options,
  });
};

export const UpdateDateColumn = (options: ColumnOptions = {}): PropertyDecorator => {
  return Column({
    type: 'timestamp with time zone',
    default: 'now()',
    ...options,
  });
};

export const DeleteDateColumn = (options: ColumnOptions = {}): PropertyDecorator => {
  return Column({
    type: 'timestamp with time zone',
    nullable: true,
    default: 'now()',
    ...options,
  });
};

type Action = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
type RelationOptions = { onUpdate?: Action; onDelete?: Action; nullable?: boolean };
export const ManyToOne = (target: () => object, options: RelationOptions): PropertyDecorator => {
  return (object: object, propertyName: string | symbol) => {
    relationOptions.push({ object, propertyName, options, type: DatabaseRelationType.MANY_TO_ONE, target });
  };
};

export const OneToOne = (target: () => object, options: RelationOptions): PropertyDecorator => {
  return (object: object, propertyName: string | symbol) => {
    relationOptions.push({ object, propertyName, options, type: DatabaseRelationType.ONE_TO_ONE, target });
  };
};

const asSnakeCase = (name: string): string => name.replaceAll(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

const findByName = <T extends { name: string }>(items: T[], name?: string) =>
  name ? items.find((item) => item.name === name) : undefined;

export const getDynamicSchema = () => {
  if (!initialized) {
    for (const { options, target } of tables) {
      const tableName = options.name || asSnakeCase(target.name);
      Reflect.defineMetadata(SchemaKey.TableName, tableName, target);

      dynamicSchema.tables.push({
        name: tableName,
        columns: [],
        constraints: [],
        indexes: [],
      });
    }

    for (const { object, propertyName, options } of columns) {
      const table = findByName(dynamicSchema.tables, Reflect.getMetadata(SchemaKey.TableName, object.constructor));
      if (!table) {
        continue;
      }

      const columnName = String(options.name ?? propertyName);

      Reflect.defineMetadata(SchemaKey.ColumnName, columnName, object, propertyName);

      let defaultValue: string | undefined;
      if (options.default !== undefined) {
        const value = options.default;

        if (typeof value === 'boolean') {
          defaultValue = value ? 'TRUE' : 'FALSE';
        } else if (value instanceof Date) {
          defaultValue = value.toISOString();
        } else if (value === null) {
          options.nullable = true;
        } else {
          defaultValue = String(value);
        }
      }

      // TODO make sure column name is unique

      table.columns.push({
        name: columnName,
        primary: options.primary ?? false,
        tableName: table.name,
        nullable: options.nullable ?? false,
        default: defaultValue,
        values: options.enum ? Object.values(options.enum) : undefined,
        isArray: options.array ?? false,
        type: options.type || 'character varying',
      });

      if (!options.primary && options.unique) {
        table.constraints.push({
          type: DatabaseConstraintType.UNIQUE,
          name: asUniqueConstraintName(table.name, [columnName]),
          tableName: table.name,
          columnNames: [columnName],
        });
      }
    }

    for (const table of dynamicSchema.tables) {
      const columnNames: string[] = [];

      for (const column of table.columns) {
        if (column.primary) {
          columnNames.push(column.name);
        }
      }

      if (columnNames.length > 0) {
        table.constraints.push({
          type: DatabaseConstraintType.PRIMARY_KEY,
          name: asPrimaryKeyConstraintName(table.name, columnNames),
          tableName: table.name,
          columnNames,
        });
      }
    }

    // indexes added at the `@Table()` level
    for (const { object, options } of indexes) {
      const table = findByName(dynamicSchema.tables, Reflect.getMetadata(SchemaKey.TableName, object));
      if (!table) {
        console.warn(`Failed to fine table for \`@ColumnIndex()\` on ${object}`);
        continue;
      }

      table.indexes.push({
        name: options.name || '',
        tableName: table.name,
        unique: options.unique ?? false,
        expression: options.expression,
        using: options.using,
        where: options.where,
        columnNames: options.columns,
      });
    }

    // indexes added at the `@Column()` level
    for (const { object, propertyName, options } of columnIndexes) {
      const table = findByName(dynamicSchema.tables, Reflect.getMetadata(SchemaKey.TableName, object.constructor));
      if (!table) {
        console.warn(
          `Failed to fine table for \`@ColumnIndex()\` on ${object.constructor.name}.${String(propertyName)}`,
        );
        continue;
      }

      const column = findByName(table.columns, Reflect.getMetadata(SchemaKey.ColumnName, object, propertyName));
      if (!column) {
        continue;
      }

      table.indexes.push({
        name: options.name || '',
        tableName: table.name,
        unique: options.unique ?? false,
        expression: options.expression,
        using: options.using,
        where: options.where,
        columnNames: [column.name],
      });
    }

    for (const { object, propertyName, options, type, target } of relationOptions) {
      const childTable = findByName(dynamicSchema.tables, Reflect.getMetadata(SchemaKey.TableName, object.constructor));
      if (!childTable) {
        continue;
      }

      const parentTable = findByName(dynamicSchema.tables, Reflect.getMetadata(SchemaKey.TableName, target()));
      if (!parentTable) {
        continue;
      }

      switch (type) {
        case DatabaseRelationType.MANY_TO_ONE: {
          const columnName = String(propertyName) + 'Id';
          let column = childTable.columns.find((column) => column.name === columnName);
          if (!column) {
            column = {
              name: columnName,
              tableName: childTable.name,
              type: 'uuid',
              nullable: options.nullable ?? false,
              isArray: false,
            };
            childTable.columns.push(column);
          }

          const columnNames = [column.name];
          const referenceColumnNames = parentTable.columns
            .filter((column) => column.primary)
            .map((column) => column.name);

          childTable.constraints.push({
            name: asForeignKeyConstraintName(childTable.name, columnNames),
            tableName: childTable.name,
            columnNames,
            type: DatabaseConstraintType.FOREIGN_KEY,
            referenceTableName: parentTable.name,
            referenceColumnNames,
            onUpdate: options.onUpdate as DatabaseActionType,
            onDelete: options.onDelete as DatabaseActionType,
          });

          break;
        }
      }
    }

    initialized = true;
  }

  return dynamicSchema;
};
