import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrations } from './migrations.gen'
import * as schema from './schema'

/** The only user there is. Local-first means no accounts, no sessions. */
export const LOCAL_USER_ID = 'local'

function sqlitePath() {
  return process.env.SHEET_SQLITE_PATH?.trim() || './data/sheet.db'
}

function openDatabase() {
  const path = sqlitePath()
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path, { create: true })
  // Writers are rare (pointer-up commits, MCP tool calls); readers are MT.
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  return sqlite
}

const sqlite = openDatabase()

export const db = drizzle(sqlite, { schema })

/**
 * Applies the pending migrations. They are embedded (see
 * scripts/embed-migrations.ts), not read from `drizzle/`: the compiled server has
 * no such folder. The bookkeeping table, hashes and ordering are drizzle's own,
 * so a database migrated either way stays valid.
 */
function applyMigrations(database: Database) {
  database.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  )
  const last = database
    .query<{ created_at: number | string }, []>(
      'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
    )
    .get()
  const record = database.query('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
  const apply = database.transaction(() => {
    for (const migration of migrations) {
      if (last && Number(last.created_at) >= migration.when) continue
      for (const statement of migration.sql.split('--> statement-breakpoint')) database.exec(statement)
      record.run(createHash('sha256').update(migration.sql).digest('hex'), migration.when)
    }
  })
  apply()
}

applyMigrations(sqlite)

export async function checkDatabaseConnection() {
  sqlite.query('select 1 as ready').get()
}

/** The single row everything is scoped by. Created on first boot. */
export async function ensureLocalUser() {
  await db
    .insert(schema.user)
    .values({ id: LOCAL_USER_ID, name: 'Local', email: 'local@sheet.design' })
    .onConflictDoNothing()
}
