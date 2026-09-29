import { createFileRoute, redirect } from '@tanstack/react-router'
import { CanvasApp } from '@sheet/editor/app'
import { designValidateSearch } from '@sheet/shell/lib/url-state'

export const Route = createFileRoute('/design/$id_/b/$branchId')({
  component: BranchDesignPage,
  validateSearch: designValidateSearch,
  beforeLoad: ({ params, search }) => {
    if (!search.draft) return
    const { draft: _draft, ...editorSearch } = search
    throw redirect({
      to: '/design/$id/b/$branchId',
      params,
      search: editorSearch,
      replace: true,
    })
  },
})

function BranchDesignPage() {
  const { id, branchId } = Route.useParams()

  return (
    <CanvasApp
      key={`${id}:${branchId}`}
      designId={id}
      branchId={branchId}
    />
  )
}
