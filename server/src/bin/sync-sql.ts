#!/usr/bin/env node
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KyselyModule } from 'nestjs-kysely';
import { OpenTelemetryModule } from 'nestjs-otel';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format } from 'sql-formatter';
import { GENERATE_SQL_KEY, GenerateSqlQueries } from 'src/decorators';
import { entities } from 'src/entities';
import { ILoggerRepository } from 'src/interfaces/logger.interface';
import { repositories } from 'src/repositories';
import { AccessRepository } from 'src/repositories/access.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { AuthService } from 'src/services/auth.service';
import { Logger } from 'typeorm';

export class SqlLogger implements Logger {
  queries: string[] = [];
  errors: Array<{ error: string | Error; query: string }> = [];

  clear() {
    this.queries = [];
    this.errors = [];
  }

  logQuery(query: string) {
    this.queries.push(format(query, { language: 'postgresql' }));
  }

  logQueryError(error: string | Error, query: string) {
    this.errors.push({ error, query });
  }

  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

const reflector = new Reflector();

type Repository = (typeof repositories)[0]['useClass'];
type Provider = { provide: any; useClass: Repository };
type SqlGeneratorOptions = { targetDir: string };

class SqlGenerator {
  private app: INestApplication | null = null;
  private sqlLogger = new SqlLogger();
  private results: Record<string, string[]> = {};

  constructor(private options: SqlGeneratorOptions) {}

  async run() {
    try {
      await this.setup();
      for (const repository of repositories) {
        if (repository.provide === ILoggerRepository) {
          continue;
        }
        await this.process(repository);
      }
      await this.write();
      this.stats();
    } finally {
      await this.close();
    }
  }

  private async setup() {
    await rm(this.options.targetDir, { force: true, recursive: true });
    await mkdir(this.options.targetDir);

    process.env.DB_HOSTNAME = 'localhost';
    const { database, otel } = new ConfigRepository().getEnv();

    const moduleFixture = await Test.createTestingModule({
      imports: [
        KyselyModule.forRoot({
          ...database.config.kysely,
          log: (event) => {
            if (event.level === 'query') {
              this.sqlLogger.logQuery(event.query.sql);
            } else if (event.level === 'error') {
              this.sqlLogger.logQueryError(event.error as Error, event.query.sql);
            }
          },
        }),
        TypeOrmModule.forRoot({
          ...database.config.typeorm,
          entities,
          logging: ['query'],
          logger: this.sqlLogger,
        }),
        TypeOrmModule.forFeature(entities),
        OpenTelemetryModule.forRoot(otel),
      ],
      providers: [...repositories, AuthService, SchedulerRegistry],
    }).compile();

    this.app = await moduleFixture.createNestApplication().init();
  }

  async process({ provide: token, useClass: Repository }: Provider) {
    if (!this.app) {
      throw new Error('Not initialized');
    }

    const data: string[] = [`-- NOTE: This file is auto generated by ./sql-generator`];
    const instance = this.app.get<Repository>(token);

    // normal repositories
    data.push(...(await this.runTargets(instance, `${Repository.name}`)));

    // nested repositories
    if (Repository.name === AccessRepository.name) {
      for (const key of Object.keys(instance)) {
        const subInstance = (instance as any)[key];
        data.push(...(await this.runTargets(subInstance, `${Repository.name}.${key}`)));
      }
    }

    this.results[Repository.name] = data;
  }

  private async runTargets(instance: any, label: string) {
    const data: string[] = [];

    for (const key of this.getPropertyNames(instance)) {
      const target = instance[key];
      if (!(target instanceof Function)) {
        continue;
      }

      const queries = reflector.get<GenerateSqlQueries[] | undefined>(GENERATE_SQL_KEY, target);
      if (!queries) {
        continue;
      }

      // empty decorator implies calling with no arguments
      if (queries.length === 0) {
        queries.push({ params: [] });
      }

      for (const { name, params } of queries) {
        let queryLabel = `${label}.${key}`;
        if (name) {
          queryLabel += ` (${name})`;
        }

        this.sqlLogger.clear();

        // errors still generate sql, which is all we care about
        await target.apply(instance, params).catch((error: Error) => console.error(`${queryLabel} error: ${error}`));

        if (this.sqlLogger.queries.length === 0) {
          console.warn(`No queries recorded for ${queryLabel}`);
          continue;
        }

        data.push([`-- ${queryLabel}`, ...this.sqlLogger.queries].join('\n'));
      }
    }

    return data;
  }

  private async write() {
    for (const [repoName, data] of Object.entries(this.results)) {
      // only contains the header
      if (data.length === 1) {
        continue;
      }
      const filename = repoName.replaceAll(/[A-Z]/g, (letter) => `.${letter.toLowerCase()}`).replace('.', '');
      const file = join(this.options.targetDir, `${filename}.sql`);
      await writeFile(file, data.join('\n\n') + '\n');
    }
  }

  private stats() {
    console.log(`Wrote ${Object.keys(this.results).length} files`);
    console.log(`Generated ${Object.values(this.results).flat().length} queries`);
  }

  private async close() {
    if (this.app) {
      await this.app.close();
    }
  }

  private getPropertyNames(instance: any): string[] {
    return Object.getOwnPropertyNames(Object.getPrototypeOf(instance)) as any[];
  }
}

new SqlGenerator({ targetDir: './src/queries' })
  .run()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    console.log('Something went wrong');
    process.exit(1);
  });
