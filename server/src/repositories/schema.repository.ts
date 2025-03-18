import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { GenerateSql } from 'src/decorators';

export type PostgresDB = {
  pg_attribute: {
    attrelid: number;
    attname: string;
    attnum: number;
    atttypeid: number;
    attstattarget: number;
    attstatarget: number;
    aanum: number;
  };

  pg_class: {
    oid: number;
    relname: string;
    relkind: string;
    relnamespace: string;
    reltype: string;
    relowner: string;
    relam: string;
    relfilenode: string;
    reltablespace: string;
    relpages: number;
    reltuples: number;
    relallvisible: number;
    reltoastrelid: string;
    relhasindex: YesOrNo;
    relisshared: YesOrNo;
    relpersistence: string;
  };

  pg_constraint: {
    oid: number;
    conname: string;
    conrelid: string;
    contype: string;
    connamespace: string;
    conkey: number[];
    confkey: number[];
    confrelid: string;
    confupdtype: string;
    confdeltype: string;
    confmatchtype: number;
    condeferrable: YesOrNo;
    condeferred: YesOrNo;
    convalidated: YesOrNo;
    conindid: number;
  };

  pg_enum: {
    oid: string;
    enumtypid: string;
    enumsortorder: number;
    enumlabel: string;
  };

  pg_index: {
    indexrelid: string;
    indrelid: string;
    indisready: boolean;
    indexprs: string | null;
    indpred: string | null;
    indkey: number[];
    indisprimary: boolean;
    indisunique: boolean;
  };

  pg_indexes: {
    schemaname: string;
    tablename: string;
    indexname: string;
    tablespace: string | null;
    indexrelid: string;
    indexdef: string;
  };

  pg_namespace: {
    oid: number;
    nspname: string;
    nspowner: number;
    nspacl: string[];
  };

  pg_type: {
    oid: string;
    typname: string;
    typnamespace: string;
    typowner: string;
    typtype: string;
    typcategory: string;
    typarray: string;
  };

  'information_schema.tables': {
    table_catalog: string;
    table_schema: string;
    table_name: string;
    table_type: 'VIEW' | 'BASE TABLE' | string;
    is_insertable_info: YesOrNo;
    is_typed: YesOrNo;
    commit_action: string | null;
  };

  'information_schema.columns': {
    table_catalog: string;
    table_schema: string;
    table_name: string;
    column_name: string;
    ordinal_position: number;
    column_default: string | null;
    is_nullable: YesOrNo;
    data_type: string;
    dtd_identifier: string;
    character_maximum_length: number | null;
    character_octet_length: number | null;
    numeric_precision: number | null;
    numeric_precision_radix: number | null;
    numeric_scale: number | null;
    datetime_precision: number | null;
    interval_type: string | null;
    interval_precision: number | null;
    udt_catalog: string;
    udt_schema: string;
    udt_name: string;
    maximum_cardinality: number | null;
    is_updatable: YesOrNo;
  };

  'information_schema.element_types': {
    object_catalog: string;
    object_schema: string;
    object_name: string;
    object_type: string;
    collection_type_identifier: string;
    data_type: string;
  };
};

type YesOrNo = 'YES' | 'NO';

@Injectable()
export class SchemaRepository {
  constructor(@InjectKysely() private db: Kysely<PostgresDB>) {}

  @GenerateSql({ params: ['public'] })
  getTables(schemaName: string) {
    return this.db
      .selectFrom('information_schema.tables')
      .where('table_schema', '=', schemaName)
      .where('table_type', '=', sql.lit('BASE TABLE'))
      .selectAll()
      .execute();
  }

  @GenerateSql({ params: ['public'] })
  async getUserDefinedEnums(schemaName: string) {
    const items = await this.db
      .selectFrom('pg_type')
      .innerJoin('pg_namespace', (join) =>
        join.onRef('pg_namespace.oid', '=', 'pg_type.typnamespace').on('pg_namespace.nspname', '=', schemaName),
      )
      .where('typtype', '=', sql.lit('e'))
      .select((eb) => [
        'pg_type.typname as name',
        jsonArrayFrom(
          eb.selectFrom('pg_enum as e').select(['e.enumlabel as value']).whereRef('e.enumtypid', '=', 'pg_type.oid'),
        ).as('values'),
      ])
      .execute();

    return items.map((item) => ({ name: item.name, values: item.values.map(({ value }) => value) }));
  }

  @GenerateSql({ params: ['public'] })
  getTableColumns(schemaName: string) {
    return this.db
      .selectFrom('information_schema.columns as c')
      .leftJoin('information_schema.element_types as o', (join) =>
        join
          .onRef('c.table_catalog', '=', 'o.object_catalog')
          .onRef('c.table_schema', '=', 'o.object_schema')
          .onRef('c.table_name', '=', 'o.object_name')
          .on('o.object_type', '=', sql.lit('TABLE'))
          .onRef('c.dtd_identifier', '=', 'o.collection_type_identifier'),
      )
      .leftJoin('pg_type as t', (join) =>
        join.onRef('t.typname', '=', 'c.udt_name').on('c.data_type', '=', sql.lit('USER-DEFINED')),
      )
      .leftJoin('pg_enum as e', (join) => join.onRef('e.enumtypid', '=', 't.oid'))
      .select([
        'c.table_name',
        'c.column_name',

        // is ARRAY, USER-DEFINED, or data type
        'c.data_type',
        'c.column_default',
        'c.is_nullable',

        // number types
        'c.numeric_precision',
        'c.numeric_scale',

        // date types
        'c.datetime_precision',

        // user defined type
        'c.udt_catalog',
        'c.udt_schema',
        'c.udt_name',

        // data type for ARRAYs
        'o.data_type as array_type',
      ])
      .where('table_schema', '=', schemaName)
      .execute();
  }

  @GenerateSql({ params: ['public'] })
  getTableIndexes(schemaName: string) {
    return (
      this.db
        .selectFrom('pg_index as ix')
        // matching index, which has column information
        .innerJoin('pg_class as i', 'ix.indexrelid', 'i.oid')
        // matching table
        .innerJoin('pg_class as t', 'ix.indrelid', 't.oid')
        // namespace
        .innerJoin('pg_namespace', 'pg_namespace.oid', 'i.relnamespace')
        // PK and UQ constraints automatically have indexes, so we can ignore those
        .leftJoin('pg_constraint', (join) =>
          join
            .onRef('pg_constraint.conindid', '=', 'i.oid')
            .on('pg_constraint.contype', 'in', [sql.lit('p'), sql.lit('u')]),
        )
        .where('pg_constraint.oid', 'is', null)
        .select((eb) => [
          'i.relname as index_name',
          't.relname as table_name',
          'ix.indisunique as unique',
          eb.fn<string>('pg_get_expr', ['ix.indexprs', 'ix.indrelid']).as('expression'),
          eb.fn<string>('pg_get_expr', ['ix.indpred', 'ix.indrelid']).as('where'),
          eb
            .selectFrom('pg_attribute as a')
            .where('t.relkind', '=', sql.lit('r'))
            .whereRef('a.attrelid', '=', 't.oid')
            // list of columns numbers in the index
            .whereRef('a.attnum', '=', sql`any("ix"."indkey")`)
            .select((eb) => eb.fn<string[]>('json_agg', ['a.attname']).as('column_name'))
            .as('column_names'),
        ])
        .where('pg_namespace.nspname', '=', schemaName)
        .where('ix.indisprimary', '=', sql.lit(false))
        .execute()
    );
  }

  @GenerateSql({ params: ['public'] })
  getTableConstraints(schemaName: string) {
    return this.db
      .selectFrom('pg_constraint')
      .innerJoin('pg_namespace', 'pg_namespace.oid', 'pg_constraint.connamespace') // namespace
      .innerJoin('pg_class as source_table', (join) =>
        join.onRef('source_table.oid', '=', 'pg_constraint.conrelid').on('source_table.relkind', 'in', [
          // ordinary table
          sql.lit('r'),
          // partitioned table
          sql.lit('p'),
          // foreign table
          sql.lit('f'),
        ]),
      ) // table
      .leftJoin('pg_class as reference_table', 'reference_table.oid', 'pg_constraint.confrelid') // reference table
      .select((eb) => [
        'pg_constraint.contype as constraint_type',
        'pg_constraint.conname as constraint_name',
        'source_table.relname as table_name',
        'reference_table.relname as reference_table_name',
        'pg_constraint.confupdtype as update_action',
        'pg_constraint.confdeltype as delete_action',
        // 'pg_constraint.oid as constraint_id',
        eb
          .selectFrom('pg_attribute')
          // matching table for PK, FK, and UQ
          .whereRef('pg_attribute.attrelid', '=', 'pg_constraint.conrelid')
          .whereRef('pg_attribute.attnum', '=', sql`any("pg_constraint"."conkey")`)
          .select((eb) => eb.fn<string[]>('json_agg', ['pg_attribute.attname']).as('column_name'))
          .as('column_names'),
        eb
          .selectFrom('pg_attribute')
          // matching foreign table for FK
          .whereRef('pg_attribute.attrelid', '=', 'pg_constraint.confrelid')
          .whereRef('pg_attribute.attnum', '=', sql`any("pg_constraint"."confkey")`)
          .select((eb) => eb.fn<string[]>('json_agg', ['pg_attribute.attname']).as('column_name'))
          .as('reference_column_names'),
        eb.fn<string>('pg_get_constraintdef', ['pg_constraint.oid']).as('expression'),
      ])
      .where('pg_namespace.nspname', '=', schemaName)
      .execute();
  }
}
