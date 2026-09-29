import {
  archiveDesign,
  deleteDesign,
  listArchivedDesigns,
  listDesigns,
  restoreDesign,
} from './designs'
import {
  applyWebCanvasTransaction,
  createWebCanvasDesign,
  getWebCanvas,
  migrateWebCanvas,
  renameWebCanvasDesign,
} from './web-canvas-procedures'
import {
  applyDraft,
  closeDraft,
  compareDraft,
  createDraft,
  listDrafts,
  proposeDraft,
  renameDraft,
  reopenDraft,
} from './branches'
import { createDesignHandoff } from './handoff-procedures'
import {
  commitWebVersion,
  compareWebVersion,
  listVersions,
  restoreWebVersion,
} from './versions'
import { deleteAsset, listAssets, uploadAsset } from './assets'
import { getPreferences, savePreferences } from './preferences'

export type { ORPCContext } from './procedures'

export const appRouter = {
  preferences: { get: getPreferences, save: savePreferences },
  design: {
    list: listDesigns,
    listArchived: listArchivedDesigns,
    archive: archiveDesign,
    restore: restoreDesign,
    delete: deleteDesign,
  },
  webCanvas: {
    create: createWebCanvasDesign,
    get: getWebCanvas,
    rename: renameWebCanvasDesign,
    migrate: migrateWebCanvas,
    applyTransaction: applyWebCanvasTransaction,
  },
  draft: {
    list: listDrafts,
    create: createDraft,
    rename: renameDraft,
    propose: proposeDraft,
    reopen: reopenDraft,
    compare: compareDraft,
    apply: applyDraft,
    close: closeDraft,
  },
  handoff: { create: createDesignHandoff },
  history: {
    list: listVersions,
    commitWeb: commitWebVersion,
    compareWeb: compareWebVersion,
    restoreWeb: restoreWebVersion,
  },
  asset: { list: listAssets, upload: uploadAsset, delete: deleteAsset },
}
