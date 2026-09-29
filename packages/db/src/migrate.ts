import { resolve } from 'node:path'

process.env.SHEET_SQLITE_PATH = resolve(
  import.meta.dir,
  '../../../',
  process.env.SHEET_SQLITE_PATH ?? 'data/sheet.db',
)

await import('./index')
