import { Injectable } from '@nestjs/common';
import { DatabaseActionType, DatabaseConstraintType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SchemaRepository } from 'src/repositories/schema.repository';
import {
  DatabaseCheckConstraint,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseConstraint,
  DatabaseForeignKeyConstraint,
  DatabaseIndex,
  DatabasePrimaryKeyConstraint,
  DatabaseSchema,
  DatabaseTable,
  DatabaseUniqueConstraint,
} from 'src/types';
import { setIsEqual } from 'src/utils/set';

type LoadSchemaOptions = {
  schemaName?: string;
};

type SchemaDiff =
  | { type: 'table.create'; tableName: string; columns: DatabaseColumn[] }
  | { type: 'table.delete'; tableName: string }
  | { type: 'column.create'; column: DatabaseColumn }
  | { type: 'column.update'; source: DatabaseColumn; target: DatabaseColumn }
  | { type: 'column.delete'; tableName: string; columnName: string }
  | { type: 'constraint.create'; constraint: DatabaseConstraint }
  | { type: 'constraint.delete'; tableName: string; constraintName: string }
  | { type: 'index.create'; index: DatabaseIndex }
  | { type: 'index.delete'; indexName: string };

const asDatabaseAction = (action: string) => {
  switch (action) {
    case 'a': {
      return DatabaseActionType.NO_ACTION;
    }
    case 'c': {
      return DatabaseActionType.CASCADE;
    }
    case 'r': {
      return DatabaseActionType.RESTRICT;
    }
    case 'n': {
      return DatabaseActionType.SET_NULL;
    }
    case 'd': {
      return DatabaseActionType.SET_DEFAULT;
    }

    default: {
      return DatabaseActionType.NO_ACTION;
    }
  }
};
const asColumnsNames = (columns: string[]) =>
  columns
    .toSorted()
    .map((column) => `"${column}"`)
    .join(', ');
const withNull = (column: DatabaseColumn) => (column.nullable ? '' : ' NOT NULL');
const withDefault = (column: DatabaseColumn) => (column.default ? ` DEFAULT ${column.default}` : '');
const withAction = (constraint: { onDelete?: DatabaseActionType; onUpdate?: DatabaseActionType }) =>
  (constraint.onDelete ? ` ON DELETE ${constraint.onDelete}` : '') +
  (constraint.onUpdate ? ` ON UPDATE ${constraint.onUpdate}` : '');

const haveEqualColumns = (sourceColumns?: string[], targetColumns?: string[]) => {
  return setIsEqual(new Set(sourceColumns ?? []), new Set(targetColumns ?? []));
};

@Injectable()
export class SchemaService {
  constructor(
    private schemaRepository: SchemaRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(SchemaService.name);
  }

  async loadSchema(options: LoadSchemaOptions = {}): Promise<DatabaseSchema> {
    const schemaName = options.schemaName || 'public';

    const tablesMap: Record<string, DatabaseTable> = {};

    const [tables, columns, indexes, constraints, enums] = await Promise.all([
      this.schemaRepository.getTables(schemaName),
      this.schemaRepository.getTableColumns(schemaName),
      this.schemaRepository.getTableIndexes(schemaName),
      this.schemaRepository.getTableConstraints(schemaName),
      this.schemaRepository.getUserDefinedEnums(schemaName),
    ]);

    const enumMap = Object.fromEntries(enums.map((e) => [e.name, e.values]));

    for (const table of tables) {
      const tableName = table.table_name;
      if (tablesMap[tableName]) {
        continue;
      }

      tablesMap[table.table_name] = {
        name: table.table_name,
        columns: [],
        indexes: [],
        constraints: [],
      };
    }

    for (const column of columns) {
      const table = tablesMap[column.table_name];
      if (!table) {
        continue;
      }

      const columnName = column.column_name;

      const item: DatabaseColumn = {
        type: column.data_type as DatabaseColumnType,
        name: columnName,
        tableName: column.table_name,
        nullable: column.is_nullable === 'YES',
        isArray: false,
        numericPrecision: column.numeric_precision ?? undefined,
        numericScale: column.numeric_scale ?? undefined,
        default: column.column_default ?? undefined,
      };

      const columnLabel = `${table.name}.${columnName}`;

      switch (column.data_type) {
        case 'ARRAY': {
          if (!column.array_type) {
            this.logger.warn(`Unable to find type for ${columnLabel} (ARRAY)`);
            continue;
          }
          item.type = column.array_type as DatabaseColumnType;
          break;
        }

        case 'USER-DEFINED': {
          if (!enumMap[column.udt_name]) {
            this.logger.warn(`Unable to find type for ${columnLabel} (ENUM)`);
            continue;
          }

          item.values = enumMap[column.udt_name];
          item.type = 'enum';
          break;
        }
      }

      table.columns.push(item);
    }

    for (const index of indexes) {
      const table = tablesMap[index.table_name];
      if (!table) {
        continue;
      }

      const indexName = index.index_name;

      table.indexes.push({
        name: indexName,
        tableName: index.table_name,
        columnNames: index.column_names ?? undefined,
        expression: index.expression ?? undefined,
        where: index.where ?? undefined,
        unique: index.unique,
      });
    }

    for (const constraint of constraints) {
      const table = tablesMap[constraint.table_name];
      if (!table) {
        continue;
      }

      const constraintName = constraint.constraint_name;

      switch (constraint.constraint_type) {
        // primary key constraint
        case 'p': {
          if (!constraint.column_names) {
            this.logger.warn(`Skipping CONSTRAINT "${constraintName}", no columns found`);
            continue;
          }
          table.constraints.push({
            type: DatabaseConstraintType.PRIMARY_KEY,
            name: constraintName,
            tableName: constraint.table_name,
            columnNames: constraint.column_names,
          });
          break;
        }

        // foreign key constraint
        case 'f': {
          if (!constraint.column_names || !constraint.reference_table_name || !constraint.reference_column_names) {
            this.logger.warn(
              `Skipping CONSTRAINT "${constraintName}", missing either columns, referenced table, or referenced columns,`,
            );
            continue;
          }

          table.constraints.push({
            type: DatabaseConstraintType.FOREIGN_KEY,
            name: constraintName,
            tableName: constraint.table_name,
            columnNames: constraint.column_names,
            referenceTableName: constraint.reference_table_name,
            referenceColumnNames: constraint.reference_column_names,
            onUpdate: asDatabaseAction(constraint.update_action),
            onDelete: asDatabaseAction(constraint.delete_action),
          });
          break;
        }

        // unique constraint
        case 'u': {
          const columnNames = constraint.expression
            .match(/\((?<expression>[^)]+)\)/)
            ?.groups?.expression?.split(',')
            .map((column) => column.replaceAll('"', '').trim());
          if (!columnNames) {
            this.logger.warn(`Unable to parse ${constraintName} expression: "${constraint.expression}, skipping"`);
            continue;
          }

          table.constraints.push({
            type: DatabaseConstraintType.UNIQUE,
            name: constraintName,
            tableName: constraint.table_name,
            columnNames,
          });
          break;
        }

        //  check constraint
        case 'c': {
          table.constraints.push({
            type: DatabaseConstraintType.CHECK,
            name: constraint.constraint_name,
            tableName: constraint.table_name,
            expression: constraint.expression.replace('CHECK ', ''),
          });
          break;
        }
      }
    }

    return {
      name: schemaName,
      tables: Object.values(tablesMap),
    };
  }

  diff(source: DatabaseSchema, target: DatabaseSchema, options: { ignoreExtraTables?: boolean } = {}) {
    const items = this.diffTables(source.tables, target.tables, {
      ignoreExtraTables: options.ignoreExtraTables ?? true,
    });

    return items;
  }

  private diffTables(sources: DatabaseTable[], targets: DatabaseTable[], options: { ignoreExtraTables: boolean }) {
    const items: SchemaDiff[] = [];
    const sourceMap = Object.fromEntries(sources.map((table) => [table.name, table]));
    const targetMap = Object.fromEntries(targets.map((table) => [table.name, table]));
    const keys = new Set([...Object.keys(sourceMap), ...Object.keys(targetMap)]);

    for (const key of keys) {
      if (options.ignoreExtraTables && !sourceMap[key]) {
        continue;
      }
      items.push(...this.diffTable(sourceMap[key], targetMap[key]));
    }

    return items;
  }

  private diffTable(source?: DatabaseTable, target?: DatabaseTable): SchemaDiff[] {
    if (source && !target) {
      return [
        { type: 'table.create', tableName: source.name, columns: Object.values(source.columns) },
        ...this.diffIndexes(source.indexes, []),
        // TODO merge constraints into table create record when possible
        ...this.diffConstraints(source.constraints, []),
      ];
    }

    if (!source && target) {
      return [{ type: 'table.delete', tableName: target.name }];
    }

    if (!source || !target) {
      return [];
    }

    return [
      ...this.diffColumns(source.columns, target.columns),
      ...this.diffConstraints(source.constraints, target.constraints),
      ...this.diffIndexes(source.indexes, target.indexes),
    ];
  }

  private diffColumns(sources: DatabaseColumn[], targets: DatabaseColumn[]): SchemaDiff[] {
    const items: SchemaDiff[] = [];
    const sourceMap = Object.fromEntries(sources.map((column) => [column.name, column]));
    const targetMap = Object.fromEntries(targets.map((column) => [column.name, column]));
    const keys = new Set([...Object.keys(sourceMap), ...Object.keys(targetMap)]);

    for (const key of keys) {
      items.push(...this.diffColumn(sourceMap[key], targetMap[key]));
    }

    return items;
  }

  private diffColumn(source?: DatabaseColumn, target?: DatabaseColumn): SchemaDiff[] {
    if (source && !target) {
      return [{ type: 'column.create', column: source }];
    }

    if (!source && target) {
      return [{ type: 'column.delete', tableName: target.tableName, columnName: target.name }];
    }

    if (!source || !target) {
      return [];
    }

    const isTypeChanged = source.type !== target.type;
    if (isTypeChanged) {
      console.log('column type changed', { source, target });
      // TODO: convert between types via UPDATE when possible
      return this.dropAndRecreateColumn(source, target);
    }

    const isChanged =
      source.type !== target.type ||
      source.nullable !== target.nullable ||
      source.primary !== target.primary ||
      source.default !== target.default ||
      source.isArray !== target.isArray;
    if (isChanged) {
      return [
        {
          type: 'column.update',
          source,
          target,
        },
      ];
    }

    return [];
  }

  private diffConstraints(sources: DatabaseConstraint[], targets: DatabaseConstraint[]): SchemaDiff[] {
    const items: SchemaDiff[] = [];

    for (const type of Object.values(DatabaseConstraintType)) {
      const sourceMap = Object.fromEntries(
        sources.filter((item) => item.type === type).map((item) => [item.name, item]),
      );
      const targetMap = Object.fromEntries(
        targets.filter((item) => item.type === type).map((item) => [item.name, item]),
      );
      const keys = new Set([...Object.keys(sourceMap), ...Object.keys(targetMap)]);

      for (const key of keys) {
        items.push(...this.diffConstraint(sourceMap[key], targetMap[key]));
      }
    }

    return items;
  }

  private diffConstraint<T extends DatabaseConstraint>(source?: T, target?: T): SchemaDiff[] {
    if (source && !target) {
      return [{ type: 'constraint.create', constraint: source }];
    }

    if (!source && target) {
      return [{ type: 'constraint.delete', tableName: target.tableName, constraintName: target.name }];
    }

    if (!source || !target) {
      return [];
    }

    switch (source.type) {
      case DatabaseConstraintType.PRIMARY_KEY: {
        return this.diffPrimaryKeyConstraint(source, target as DatabasePrimaryKeyConstraint);
      }

      case DatabaseConstraintType.FOREIGN_KEY: {
        return this.diffForeignKeyConstraint(source, target as DatabaseForeignKeyConstraint);
      }

      case DatabaseConstraintType.UNIQUE: {
        return this.diffUniqueConstraint(source, target as DatabaseUniqueConstraint);
      }

      case DatabaseConstraintType.CHECK: {
        return this.diffCheckConstraint(source, target as DatabaseCheckConstraint);
      }

      default: {
        return this.dropAndRecreateConstraint(source, target);
      }
    }
  }

  private diffPrimaryKeyConstraint(
    source: DatabasePrimaryKeyConstraint,
    target: DatabasePrimaryKeyConstraint,
  ): SchemaDiff[] {
    if (!haveEqualColumns(source.columnNames, target.columnNames) || source.tableName !== target.tableName) {
      return this.dropAndRecreateConstraint(source, target);
    }

    return [];
  }

  private diffForeignKeyConstraint(
    source: DatabaseForeignKeyConstraint,
    target: DatabaseForeignKeyConstraint,
  ): SchemaDiff[] {
    if (
      !haveEqualColumns(source.columnNames, target.columnNames) ||
      !haveEqualColumns(source.referenceColumnNames, target.referenceColumnNames) ||
      source.tableName !== target.tableName ||
      source.referenceTableName !== target.referenceTableName ||
      source.onDelete !== target.onDelete ||
      source.onUpdate !== target.onUpdate
    ) {
      return this.dropAndRecreateConstraint(source, target);
    }

    return [];
  }

  private diffUniqueConstraint(source: DatabaseUniqueConstraint, target: DatabaseUniqueConstraint): SchemaDiff[] {
    return haveEqualColumns(source.columnNames, target.columnNames)
      ? []
      : this.dropAndRecreateConstraint(source, target);
  }

  private diffCheckConstraint(source: DatabaseCheckConstraint, target: DatabaseCheckConstraint): SchemaDiff[] {
    return source.expression === target.expression ? [] : this.dropAndRecreateConstraint(source, target);
  }

  private diffIndexes(sources: DatabaseIndex[], targets: DatabaseIndex[]) {
    const items: SchemaDiff[] = [];
    const sourceMap = Object.fromEntries(sources.map((index) => [index.name, index]));
    const targetMap = Object.fromEntries(targets.map((index) => [index.name, index]));
    const keys = new Set([...Object.keys(sourceMap), ...Object.keys(targetMap)]);

    for (const key of keys) {
      items.push(...this.diffIndex(sourceMap[key], targetMap[key]));
    }

    return items;
  }

  private diffIndex(source?: DatabaseIndex, target?: DatabaseIndex): SchemaDiff[] {
    if (source && !target) {
      return [{ type: 'index.create', index: source }];
    }

    if (!source && target) {
      return [{ type: 'index.delete', indexName: target.name }];
    }

    if (!target || !source) {
      return [];
    }

    const isChanged =
      !haveEqualColumns(source.columnNames, target.columnNames) ||
      // source.using !== target.using ||
      source.expression !== target.expression ||
      source.unique !== target.unique ||
      source.where !== target.where;
    if (isChanged) {
      console.log('drop and recreate', { source, target });
      return this.dropAndRecreateIndex(source, target);
    }

    return [];
  }

  private dropAndRecreateColumn(source: DatabaseColumn, target: DatabaseColumn): SchemaDiff[] {
    return [
      { type: 'column.delete', tableName: target.tableName, columnName: target.name },
      { type: 'column.create', column: source },
    ];
  }

  private dropAndRecreateConstraint(source: DatabaseConstraint, target: DatabaseConstraint): SchemaDiff[] {
    return [
      { type: 'constraint.delete', tableName: target.tableName, constraintName: target.name },
      { type: 'constraint.create', constraint: source },
    ];
  }

  private dropAndRecreateIndex(source: DatabaseIndex, target: DatabaseIndex): SchemaDiff[] {
    return [
      { type: 'index.delete', indexName: target.name },
      { type: 'index.create', index: source },
    ];
  }

  diffToSql(items: SchemaDiff[]): string[] {
    return items.flatMap((item) => {
      const sql = this.asSql(item);
      return Array.isArray(sql) ? sql : [sql];
    });
  }

  private asSql(item: SchemaDiff): string | string[] {
    switch (item.type) {
      case 'table.create': {
        const columns = Object.values(item.columns)
          .map((column) => `"${column.name}" ${column.type}` + withNull(column) + withDefault(column))
          .join(', ');
        return `CREATE TABLE "${item.tableName}" (${columns});`;
      }

      case 'table.delete': {
        return `DROP TABLE "${item.tableName}";`;
      }

      case 'column.create': {
        const column = item.column;

        return (
          `ALTER TABLE "${column.tableName}" ADD "${column.name}" ${column.type}` +
          withNull(column) +
          withDefault(column) +
          ';'
        );
      }

      case 'column.update': {
        if (item.source.nullable !== item.target.nullable) {
          return item.source.nullable
            ? `ALTER TABLE "${item.source.tableName}" ALTER COLUMN "${item.source.name}" DROP NOT NULL;`
            : `ALTER TABLE "${item.source.tableName}" ALTER COLUMN "${item.source.name}" SET NOT NULL;`;
        }
        break;
      }

      case 'column.delete': {
        return `ALTER TABLE "${item.tableName}" DROP COLUMN "${item.columnName}";`;
      }

      case 'constraint.create': {
        return this.asConstraintSql(item.constraint);
      }

      case 'constraint.delete': {
        return `ALTER TABLE "${item.tableName}" DROP CONSTRAINT "${item.constraintName}";`;
      }

      case 'index.create': {
        const { index } = item;
        let sql = `CREATE`;

        if (index.unique) {
          sql += ' UNIQUE';
        }

        sql += ` INDEX "${index.name}" ON "${index.tableName}"`;

        if (index.columnNames) {
          const columnNames = asColumnsNames(index.columnNames);
          sql += ` (${columnNames})`;
        }

        if (index.using) {
          sql += ` USING ${index.using}`;
        }

        if (index.expression) {
          sql += ` (${index.expression})`;
        }

        if (index.where) {
          sql += ` WHERE ${index.where}`;
        }

        return sql;
      }

      case 'index.delete': {
        return `DROP INDEX "${item.indexName}";`;
      }
    }

    return [];
  }

  private asConstraintSql(constraint: DatabaseConstraint): string | string[] {
    const base = `ALTER TABLE "${constraint.tableName}" ADD CONSTRAINT "${constraint.name}"`;
    switch (constraint.type) {
      case DatabaseConstraintType.PRIMARY_KEY: {
        const columnNames = asColumnsNames(constraint.columnNames);
        return `${base} PRIMARY KEY (${columnNames});`;
      }

      case DatabaseConstraintType.FOREIGN_KEY: {
        const columnNames = asColumnsNames(constraint.columnNames);
        const referenceColumnNames = asColumnsNames(constraint.referenceColumnNames);
        return (
          `${base} FOREIGN KEY (${columnNames}) REFERENCES "${constraint.referenceTableName}" (${referenceColumnNames})` +
          withAction(constraint) +
          ';'
        );
      }

      case DatabaseConstraintType.UNIQUE: {
        const columnNames = asColumnsNames(constraint.columnNames);
        return `${base} UNIQUE (${columnNames});`;
      }

      case DatabaseConstraintType.CHECK: {
        return `${base} CHECK (${constraint.expression});`;
      }

      default: {
        return [];
      }
    }
  }
}
