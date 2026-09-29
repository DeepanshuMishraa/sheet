import { createFileRoute, redirect } from '@tanstack/react-router'
import { CanvasApp } from '@sheet/editor/app'
import { designValidateSearch } from '@sheet/shell/lib/url-state'

export const Route = createFileRoute('/design/$id')({
  component: DesignPage,
  validateSearch: designValidateSearch,
  beforeLoad: ({ params, search }) => {
    if (!search.draft) return
    const { draft, ...editorSearch } = search
    throw redirect({
      to: '/design/$id/b/$branchId',
      params: { id: params.id, branchId: draft },
      search: editorSearch,
      replace: true,
    })
  },
})

function DesignPage() {
  const { id } = Route.useParams()

  return (
    /* Remount on switch so the sync controller opens the new target cleanly. */
    <CanvasApp key={id} designId={id} />
  )
}
