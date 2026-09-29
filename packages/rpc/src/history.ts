export interface StoredHistorySummary {
  id: string
  message: string
  added: number
  removed: number
  changed: number
  createdAt: Date
}

export function toHistoryPage(rows: StoredHistorySummary[], limit: number) {
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    message: row.message,
    added: row.added,
    removed: row.removed,
    changed: row.changed,
    at: row.createdAt.getTime(),
  }))
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > limit && last ? { at: last.at, id: last.id } : null,
  }
}
