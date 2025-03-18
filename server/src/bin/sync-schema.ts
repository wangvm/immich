#!/usr/bin/env node
process.env.DB_URL = 'postgres://postgres:postgres@localhost:5432/immich';

import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import 'src/entities/activity.entity';
import 'src/entities/album-asset.entity';
import 'src/entities/album.entity';
import 'src/entities/api-key.entity';
import 'src/entities/asset.entity';
import 'src/entities/user.entity';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PostgresDB, SchemaRepository } from 'src/repositories/schema.repository';
import { getDynamicSchema } from 'src/schema.decorator';
import { SchemaService } from 'src/services/schema.service';
import { DatabaseTable } from 'src/types';

const sync = async () => {
  const configRepository = new ConfigRepository();
  const { database } = configRepository.getEnv();

  const db = new Kysely<PostgresDB>({
    dialect: new PostgresJSDialect({ postgres: postgres(database.config.kysely) }),
  });

  const service = new SchemaService(new SchemaRepository(db), new LoggingRepository(null as any, configRepository));
  const schema = await service.loadSchema();
  const dynamicSchema = getDynamicSchema();

  const isIncluded = (table: DatabaseTable) => dynamicSchema.tables.some(({ name }) => table.name === name);

  schema.tables = schema.tables.filter((table) => isIncluded(table));

  const diff = service.diff(dynamicSchema, schema, { ignoreExtraTables: true });

  writeFileSync('schema-dynamic.json', JSON.stringify(dynamicSchema, null, 2));
  writeFileSync(
    'schema-database.json',
    JSON.stringify(
      schema.tables.filter((table) => isIncluded(table)),
      null,
      2,
    ),
  );
  writeFileSync('schema-diff.json', JSON.stringify(diff, null, 2));
  writeFileSync(
    'schema-sql.sql',
    [
      '-- UP',
      ...service.diffToSql(diff),
      '\n\n',
      // '-- DOWN',
      // ...service.diffToSql(service.diff(schema, dynamicSchema)),
    ].join('\n'),
  );

  await db.destroy();
};

sync()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    console.log('Something went wrong');
    process.exit(1);
  });
