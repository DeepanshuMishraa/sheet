import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@sheet/db'
import { asset, design, designDraft } from '@sheet/db/schema'
import { readHandoffToken } from './handoff-token'
import { assetUrl } from '@sheet/rpc/storage'
import { serializeWebStylesheets } from '@sheet/canvas/web-css'
import {
  WEB_CANVAS_STORAGE_VERSION,
  parseWebDocument,
  serializeWebDocument,
  type WebDocument,
} from '@sheet/canvas/web-model'

export function referencedAssetIds(document: WebDocument) {
  const ids = new Set<string>()
  const source = JSON.stringify(document)
  for (const match of source.matchAll(/\/api\/asset\/([a-zA-Z0-9_-]+)/g)) ids.add(match[1])
  for (const match of source.matchAll(/\/assets\/[a-zA-Z0-9_-]+\/(a[0-9a-f]{32})/g)) ids.add(match[1])
  return ids
}

export async function getHandoffDesign(token: string) {
  const claims = await readHandoffToken(token)
  if (!claims) return null
  const [main] = await db
    .select({
      id: design.id,
      name: design.name,
      canvasVersion: design.canvasVersion,
      canvasDocument: design.canvasDocument,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(and(eq(design.id, claims.designId), eq(design.userId, claims.userId)))
    .limit(1)
  if (!main) return null

  const target = claims.draftId
    ? await db
        .select({
          canvasVersion: designDraft.canvasVersion,
          canvasDocument: designDraft.canvasDocument,
          revision: designDraft.revision,
          updatedAt: designDraft.updatedAt,
        })
        .from(designDraft)
        .where(and(
          eq(designDraft.id, claims.draftId),
          eq(designDraft.designId, claims.designId),
          eq(designDraft.userId, claims.userId),
        ))
        .limit(1)
        .then((rows) => rows[0])
    : main
  if (
    !target ||
    target.canvasVersion !== WEB_CANVAS_STORAGE_VERSION ||
    !target.canvasDocument
  ) return null

  return {
    id: main.id,
    name: main.name,
    userId: claims.userId,
    revision: target.revision,
    updatedAt: target.updatedAt,
    document: parseWebDocument(target.canvasDocument),
  }
}

export async function buildHandoffPayload(token: string, origin: string) {
  const found = await getHandoffDesign(token)
  if (!found) return null
  const assetIds = referencedAssetIds(found.document)
  const assets = assetIds.size
    ? await db
        .select({
          id: asset.id,
          name: asset.name,
          mediaType: asset.mediaType,
          size: asset.size,
          storageKey: asset.storageKey,
        })
        .from(asset)
        .where(and(eq(asset.userId, found.userId), inArray(asset.id, [...assetIds])))
    : []
  return {
    schema: 'sheet.design-handoff',
    version: 4,
    assets: assets.map(({ storageKey, ...item }) => ({
      ...item,
      source: assetUrl(item.id, storageKey),
      url: `${origin}/api/handoff/${encodeURIComponent(token)}/asset/${encodeURIComponent(item.id)}`,
    })),
    design: {
      id: found.id,
      name: found.name,
      updatedAt: found.updatedAt.toISOString(),
      revision: found.revision,
      document: found.document,
      html: serializeWebDocument(found.document),
      css: serializeWebStylesheets(found.document.stylesheets, found.document.stylesheetOrder),
    },
    guidance: {
      sourceOfTruth:
        'WebDocument is authored HTML and CSS as structured data. Render the included HTML and CSS directly.',
      hierarchy:
        'Use parentId and numeric order to reconstruct the DOM. Template roots are definitions, not rendered content.',
      cascade:
        'Stylesheets apply in stylesheetOrder and rules in ruleOrder. The browser resolves authored conditions.',
      components:
        'Instances are ordinary nodes plus bindings and explicit overrides.',
      computed:
        'Computed styles and geometry are browser output and are never stored.',
    },
  }
}
