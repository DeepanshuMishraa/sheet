import { Outlet, createFileRoute } from '@tanstack/react-router'

/** The shell around `/app` pages is mounted once, in the root route. */
export const Route = createFileRoute('/app')({ component: Outlet })
