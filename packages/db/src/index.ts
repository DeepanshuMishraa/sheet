import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
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

migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname })

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
