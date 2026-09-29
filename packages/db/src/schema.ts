import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import type { CanvasDocument } from '@sheet/canvas/legacy-model'
import type { WebDocument, WebTransaction } from '@sheet/canvas/web-model'
export type DraftStatus = 'active' | 'proposed' | 'applied' | 'closed'
import { EMPTY_SHORTCUT_CONFIG, type ShortcutConfig } from './shortcuts'

/**
 * Local-first schema. One user, no accounts, no sharing, no billing, no
 * publishing — just projects (designs) and everything inside them: branches,
 * versions, the transaction log, assets, and editor preferences.
 *
 * Timestamps are epoch milliseconds (`timestamp_ms`); JSON lives in TEXT
 * columns via `mode: 'json'`.
 */

const now = () => new Date()

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(now)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$defaultFn(now)
    .notNull(),
})

export const design = sqliteTable(
  'design',
  {
    id: text('id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shapes: text('shapes', { mode: 'json' })
      .$type<unknown[]>()
      .$defaultFn((): unknown[] => [])
      .notNull(),
    pages: text('pages', { mode: 'json' })
      .$type<unknown[]>()
      .$defaultFn((): unknown[] => [])
      .notNull(),
    canvasVersion: integer('canvas_version').default(1).notNull(),
    canvasDocument: text('canvas_document', { mode: 'json' }).$type<CanvasDocument | WebDocument>(),
    revision: integer('revision').default(0).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    index('design_user_id_idx').on(table.userId),
  ],
)

export const designDraft = sqliteTable(
  'design_draft',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    status: text('status').$type<DraftStatus>().default('active').notNull(),
    baseShapes: text('base_shapes', { mode: 'json' }).$type<unknown[]>().notNull(),
    shapes: text('shapes', { mode: 'json' }).$type<unknown[]>().notNull(),
    basePages: text('base_pages', { mode: 'json' })
      .$type<unknown[]>()
      .$defaultFn((): unknown[] => [])
      .notNull(),
    pages: text('pages', { mode: 'json' })
      .$type<unknown[]>()
      .$defaultFn((): unknown[] => [])
      .notNull(),
    canvasVersion: integer('canvas_version').default(1).notNull(),
    baseCanvasVersion: integer('base_canvas_version').default(1).notNull(),
    baseCanvasDocument: text('base_canvas_document', { mode: 'json' }).$type<CanvasDocument | WebDocument>(),
    canvasDocument: text('canvas_document', { mode: 'json' }).$type<CanvasDocument | WebDocument>(),
    baseRevision: integer('base_revision').notNull(),
    revision: integer('revision').default(0).notNull(),
    appliedVersionId: text('applied_version_id'),
    proposedAt: integer('proposed_at', { mode: 'timestamp_ms' }),
    appliedAt: integer('applied_at', { mode: 'timestamp_ms' }),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'design_draft_design_fk',
    }).onDelete('cascade'),
    index('design_draft_design_idx').on(
      table.userId,
      table.designId,
      table.status,
      table.updatedAt,
    ),
  ],
)

export const designVersion = sqliteTable(
  'design_version',
  {
    id: text('id').notNull(),
    designId: text('design_id').notNull(),
    draftId: text('draft_id'),
    userId: text('user_id').notNull(),
    message: text('message').notNull(),
    shapes: text('shapes', { mode: 'json' }).$type<unknown[]>().notNull(),
    pages: text('pages', { mode: 'json' })
      .$type<unknown[]>()
      .$defaultFn((): unknown[] => [])
      .notNull(),
    canvasVersion: integer('canvas_version').default(1).notNull(),
    canvasDocument: text('canvas_document', { mode: 'json' }).$type<CanvasDocument | WebDocument>(),
    added: integer('added').notNull(),
    removed: integer('removed').notNull(),
    changed: integer('changed').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'design_version_design_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.draftId, table.userId],
      foreignColumns: [designDraft.id, designDraft.userId],
      name: 'design_version_draft_fk',
    }).onDelete('cascade'),
    index('design_version_design_idx').on(
      table.userId,
      table.designId,
      table.draftId,
      table.createdAt,
    ),
  ],
)

export const canvasTransaction = sqliteTable(
  'canvas_transaction',
  {
    designId: text('design_id').notNull(),
    // The owner, because that is what the design is keyed by.
    userId: text('user_id').notNull(),
    authorUserId: text('author_user_id'),
    targetKey: text('target_key').notNull(),
    transactionId: text('transaction_id').notNull(),
    baseRevision: integer('base_revision').notNull(),
    revision: integer('revision').notNull(),
    transaction: text('transaction', { mode: 'json' }).$type<WebTransaction>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.designId, table.targetKey, table.transactionId],
    }),
    foreignKey({
      columns: [table.designId, table.userId],
      foreignColumns: [design.id, design.userId],
      name: 'canvas_transaction_design_fk',
    }).onDelete('cascade'),
    index('canvas_transaction_target_revision_idx').on(
      table.userId,
      table.designId,
      table.targetKey,
      table.revision,
    ),
    index('canvas_transaction_created_idx').on(table.createdAt),
  ],
)

export const asset = sqliteTable(
  'asset',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mediaType: text('media_type').notNull(),
    size: integer('size').notNull(),
    // S3 object key when a bucket is configured, else null…
    storageKey: text('storage_key'),
    // …and the base64 payload lives here instead. Local-first never sets a
    // bucket, so bytes always stay in this column.
    data: text('data'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(now)
      .notNull(),
  },
  (table) => [index('asset_user_id_idx').on(table.userId, table.createdAt)],
)

export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  shortcuts: text('shortcuts', { mode: 'json' })
    .$type<ShortcutConfig>()
    .$defaultFn((): ShortcutConfig => EMPTY_SHORTCUT_CONFIG)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$defaultFn(now)
    .notNull(),
})
