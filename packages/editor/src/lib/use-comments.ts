import { useCallback, useEffect, useState } from 'react'
import { orpc } from '@sheet/rpc/client'

export type DesignComment = Awaited<ReturnType<typeof orpc.comment.list>>[number]

const POLL_MS = 4_000

const sameComments = (a: DesignComment[], b: DesignComment[]) =>
  a.length === b.length && a.every((item, index) => item.id === b[index]?.id && item.updatedAt === b[index]?.updatedAt)

/**
 * The comments on one design. An agent can add or resolve them over MCP while
 * the editor is open, so the list refreshes on a slow timer and whenever the
 * window regains focus, on top of the optimistic updates for local changes.
 */
export function useDesignComments(designId: string) {
  const [comments, setComments] = useState<DesignComment[]>([])

  const refresh = useCallback(async () => {
    if (typeof orpc.comment?.list !== 'function') return
    try {
      const next = await orpc.comment.list({ designId, status: 'all' })
      // Keep the same array when nothing changed: the editor re-renders on every
      // state change, and most polls find the same comments.
      setComments((current) => (sameComments(current, next) ? current : next))
    } catch {
      // Keep showing what we have; the next refresh tries again.
    }
  }, [designId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const create = useCallback(
    async (nodeId: string, nodeLabel: string, body: string) => {
      const created = await orpc.comment.create({ designId, nodeId, nodeLabel, body })
      setComments((current) => [...current, created])
      return created
    },
    [designId],
  )

  const resolve = useCallback(
    async (commentId: string, resolved: boolean) => {
      const updated = await orpc.comment.resolve({ designId, commentId, resolved })
      setComments((current) => current.map((item) => (item.id === commentId ? updated : item)))
    },
    [designId],
  )

  const remove = useCallback(
    async (commentId: string) => {
      await orpc.comment.delete({ designId, commentId })
      setComments((current) => current.filter((item) => item.id !== commentId))
    },
    [designId],
  )

  return { comments, create, resolve, remove, refresh }
}

export type DesignComments = ReturnType<typeof useDesignComments>
