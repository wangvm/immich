import { DatabaseActionType, DatabaseConstraintType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SchemaRepository } from 'src/repositories/schema.repository';
import { SchemaService } from 'src/services/schema.service';
import {
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseConstraint,
  DatabaseIndex,
  DatabaseSchema,
  DatabaseTable,
} from 'src/types';
import { automock } from 'test/utils';

const newSchema = (schema: {
  name?: string;
  tables: Array<{
    name: string;
    columns?: Array<{ name: string; type?: DatabaseColumnType; nullable?: boolean; isArray?: boolean }>;
    indexes?: DatabaseIndex[];
    constraints?: DatabaseConstraint[];
  }>;
}): DatabaseSchema => {
  const tables: DatabaseTable[] = [];

  for (const table of schema.tables || []) {
    const tableName = table.name;
    const columns: DatabaseColumn[] = [];

    for (const column of table.columns || []) {
      const columnName = column.name;

      columns.push({
        tableName,
        name: columnName,
        type: column.type || 'character varying',
        isArray: column.isArray ?? false,
        nullable: column.nullable ?? false,
      });
    }

    tables.push({
      name: tableName,
      columns,
      indexes: table.indexes ?? [],
      constraints: table.constraints ?? [],
    });
  }

  return {
    name: schema?.name || 'public',
    tables,
  };
};

describe(SchemaService.name, () => {
  let sut: SchemaService;

  beforeEach(() => {
    const configMock = { getEnv: () => ({}) };
    const mocks = {
      schema: automock(SchemaRepository),
      logger: automock(LoggingRepository, { args: [, configMock], strict: false }),
    };

    sut = new SchemaService(mocks.schema, mocks.logger);
  });

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('diff', () => {
    it('should work', () => {
      expect(sut.diff(newSchema({ tables: [] }), newSchema({ tables: [] }))).toEqual([]);
    });

    it('should find a missing table', () => {
      const column: DatabaseColumn = {
        type: 'character varying',
        tableName: 'Table1',
        name: 'Column1',
        isArray: false,
        nullable: false,
      };
      const results = sut.diff(
        newSchema({ tables: [{ name: 'Table1', columns: [column] }] }),
        newSchema({ tables: [] }),
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ type: 'table.create', tableName: 'Table1', columns: [column] });
    });

    it('should find an extra table', () => {
      const results = sut.diff(
        newSchema({ tables: [] }),
        newSchema({ tables: [{ name: 'Table1', columns: [{ name: 'Column1' }] }] }),
        { ignoreExtraTables: false },
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ type: 'table.delete', tableName: 'Table1' });
    });

    it('should skip identical tables', () => {
      const results = sut.diff(
        newSchema({ tables: [{ name: 'Table1', columns: [{ name: 'Column1' }] }] }),
        newSchema({ tables: [{ name: 'Table1', columns: [{ name: 'Column1' }] }] }),
      );

      expect(results).toEqual([]);
    });

    it('should find a new column', () => {
      const results = sut.diff(
        newSchema({ tables: [{ name: 'Table1', columns: [{ name: 'Column1' }, { name: 'Column2' }] }] }),
        newSchema({ tables: [{ name: 'Table1', columns: [{ name: 'Column1' }] }] }),
      );

      expect(results).toEqual([
        {
          type: 'column.create',
          column: {
            tableName: 'Table1',
            isArray: false,
            name: 'Column2',
            nullable: false,
            type: 'character varying',
          },
        },
      ]);
    });
  });

  describe('diffToSql', () => {
    describe('table.create', () => {
      it('should work', () => {
        expect(
          sut.diffToSql([
            {
              type: 'table.create',
              tableName: 'Table1',
              columns: [
                {
                  tableName: 'Table1',
                  name: 'Column1',
                  type: 'character varying',
                  nullable: true,
                  isArray: false,
                },
              ],
            },
          ]),
        ).toEqual([`CREATE TABLE "Table1" ("Column1" character varying);`]);
      });

      it('should handle a non-nullable column', () => {
        expect(
          sut.diffToSql([
            {
              type: 'table.create',
              tableName: 'Table1',
              columns: [
                {
                  tableName: 'Table1',
                  name: 'Column1',
                  type: 'character varying',
                  isArray: false,
                  nullable: false,
                },
              ],
            },
          ]),
        ).toEqual([`CREATE TABLE "Table1" ("Column1" character varying NOT NULL);`]);
      });

      it('should handle a default value', () => {
        expect(
          sut.diffToSql([
            {
              type: 'table.create',
              tableName: 'Table1',
              columns: [
                {
                  tableName: 'Table1',
                  name: 'Column1',
                  type: 'character varying',
                  isArray: false,
                  nullable: true,
                  default: 'uuid_generate_v4()',
                },
              ],
            },
          ]),
        ).toEqual([`CREATE TABLE "Table1" ("Column1" character varying DEFAULT uuid_generate_v4());`]);
      });
    });

    describe('table.delete', () => {
      it('should work', () => {
        expect(
          sut.diffToSql([
            {
              type: 'table.delete',
              tableName: 'Table1',
            },
          ]),
        ).toEqual([`DROP TABLE "Table1";`]);
      });
    });

    describe('column.create', () => {
      it('should work', () => {
        expect(
          sut.diffToSql([
            {
              type: 'column.create',
              column: {
                type: 'character varying',
                tableName: 'Table1',
                name: 'Column1',
                isArray: false,
                nullable: true,
              },
            },
          ]),
        ).toEqual([`ALTER TABLE "Table1" ADD "Column1" character varying;`]);
      });
    });

    describe('column.update', () => {
      it('should make a column nullable', () => {
        expect(
          sut.diffToSql([
            {
              type: 'column.update',
              source: {
                type: 'character varying',
                isArray: false,
                name: 'Column1',
                tableName: 'Table1',
                nullable: true,
              },
              target: {
                type: 'character varying',
                isArray: false,
                name: 'Column1',
                tableName: 'Table1',
                nullable: false,
              },
            },
          ]),
        ).toEqual([`ALTER TABLE "Table1" ALTER COLUMN "Column1" DROP NOT NULL;`]);
      });

      it('should make a column non-nullable', () => {
        expect(
          sut.diffToSql([
            {
              type: 'column.update',
              source: {
                type: 'character varying',
                isArray: false,
                name: 'Column1',
                tableName: 'Table1',
                nullable: false,
              },
              target: {
                type: 'character varying',
                isArray: false,
                name: 'Column1',
                tableName: 'Table1',
                nullable: true,
              },
            },
          ]),
        ).toEqual([`ALTER TABLE "Table1" ALTER COLUMN "Column1" SET NOT NULL;`]);
      });
    });

    describe('column.delete', () => {
      it('should work', () => {
        expect(
          sut.diffToSql([
            {
              type: 'column.delete',
              tableName: 'Table1',
              columnName: 'Column1',
            },
          ]),
        ).toEqual([`ALTER TABLE "Table1" DROP COLUMN "Column1";`]);
      });
    });

    describe('constraint.create', () => {
      it('should work with a FK', () => {
        expect(
          sut.diffToSql([
            {
              type: 'constraint.create',
              constraint: {
                type: DatabaseConstraintType.FOREIGN_KEY,
                name: 'FK_1',
                tableName: 'Table1',
                columnNames: ['Column1'],
                referenceTableName: 'Table2',
                referenceColumnNames: ['Column2'],
              },
            },
          ]),
        ).toEqual([
          `ALTER TABLE "Table1" ADD CONSTRAINT "FK_1" FOREIGN KEY ("Column1") REFERENCES "Table2" ("Column2");`,
        ]);
      });

      it('should work with a UQ', () => {
        expect(
          sut.diffToSql([
            {
              type: 'constraint.create',
              constraint: {
                type: DatabaseConstraintType.UNIQUE,
                name: 'UQ_1',
                tableName: 'Table1',
                columnNames: ['Column1'],
              },
            },
          ]),
        ).toEqual([`ALTER TABLE "Table1" ADD CONSTRAINT "UQ_1" UNIQUE ("Column1");`]);
      });

      it('should work with a UQ on multiple columns', () => {
        expect(
          sut.diffToSql([
            {
              type: 'constraint.create',
              constraint: {
                type: DatabaseConstraintType.UNIQUE,
                name: 'UQ_1',
                tableName: 'Table1',
                columnNames: ['Column1', 'Column2'],
              },
            },
          ]),
        ).toEqual([`ALTER TABLE "Table1" ADD CONSTRAINT "UQ_1" UNIQUE ("Column1", "Column2");`]);
      });

      it('should handle FK onUpdate and onDelete cascades', () => {
        expect(
          sut.diffToSql([
            {
              type: 'constraint.create',
              constraint: {
                type: DatabaseConstraintType.FOREIGN_KEY,
                name: 'FK_1',
                tableName: 'Table1',
                columnNames: ['Column1'],
                referenceTableName: 'Table2',
                referenceColumnNames: ['Column2'],
                onUpdate: DatabaseActionType.CASCADE,
                onDelete: DatabaseActionType.NO_ACTION,
              },
            },
          ]),
        ).toEqual([
          `ALTER TABLE "Table1" ADD CONSTRAINT "FK_1" FOREIGN KEY ("Column1") REFERENCES "Table2" ("Column2") ON DELETE NO ACTION ON UPDATE CASCADE;`,
        ]);
      });
    });

    describe('index.create', () => {
      it('should work', () => {
        expect(
          sut.diffToSql([
            {
              type: 'index.create',
              index: {
                name: 'IDX_1',
                tableName: 'Table1',
                columnNames: ['Column1'],
              },
            },
          ]),
        ).toEqual([`CREATE INDEX "IDX_1" ON "Table1" ("Column1");`]);
      });

      it('should create a unique index', () => {
        expect(
          sut.diffToSql([
            {
              type: 'index.create',
              index: {
                name: 'IDX_1',
                tableName: 'Table1',
                columnNames: ['Column1'],
                unique: true,
              },
            },
          ]),
        ).toEqual([`CREATE UNIQUE INDEX "IDX_1" ON "Table1" ("Column1");`]);
      });
    });

    describe('index.delete', () => {
      it('should work', () => {
        expect(
          sut.diffToSql([
            {
              type: 'index.delete',
              indexName: 'IDX_1',
            },
          ]),
        ).toEqual([`DROP INDEX "IDX_1";`]);
      });
    });
  });
});
