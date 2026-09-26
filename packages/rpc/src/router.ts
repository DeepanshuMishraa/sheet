/**
 * The oRPC surface. Every namespace lives in its own module beside this one, so
 * this file is only the assembly: what a client can call, on one screen.
 *
 * Local-first: no auth, no billing, no sharing, no publishing — designs,
 * canvas, branches, handoff, history, assets, preferences.
 */
import {
  archiveDesign,
  deleteDesign,
  getDesign,
  listArchivedDesigns,
  listDesigns,
  restoreDesign,
  saveDesign,
} from './designs'
import {
  applyCanvasTransactions,
  createCanvasDesign,
  getCanvas,
  renameCanvasDesign,
} from './canvas-procedures'
import {
  applyDraft,
  closeDraft,
  compareDraft,
  createDraft,
  getDraft,
  listDrafts,
  proposeDraft,
  renameDraft,
  reopenDraft,
  saveDraft,
} from './branches'
import { createDesignHandoff } from './handoff-procedures'
import {
  commitCanvasVersion,
  commitVersion,
  compareCanvasVersion,
  compareVersion,
  importVersions,
  listVersions,
  restoreCanvasVersion,
} from './versions'
import {
  deleteAsset,
  listAssets,
  uploadAsset,
} from './assets'
import {
  getPreferences,
  savePreferences,
} from './preferences'

export type { ORPCContext } from './procedures'

export const appRouter = {
  preferences: {
    get: getPreferences,
    save: savePreferences,
  },
  design: {
    list: listDesigns,
    listArchived: listArchivedDesigns,
    get: getDesign,
    save: saveDesign,
    archive: archiveDesign,
    restore: restoreDesign,
    delete: deleteDesign,
  },
  canvas: {
    create: createCanvasDesign,
    get: getCanvas,
    rename: renameCanvasDesign,
    applyTransactions: applyCanvasTransactions,
  },
  draft: {
    list: listDrafts,
    create: createDraft,
    get: getDraft,
    save: saveDraft,
    rename: renameDraft,
    propose: proposeDraft,
    reopen: reopenDraft,
    compare: compareDraft,
    apply: applyDraft,
    close: closeDraft,
  },
  handoff: {
    create: createDesignHandoff,
  },
  history: {
    list: listVersions,
    compare: compareVersion,
    import: importVersions,
    commit: commitVersion,
    commitCanvas: commitCanvasVersion,
    compareCanvas: compareCanvasVersion,
    restoreCanvas: restoreCanvasVersion,
  },
  asset: {
    list: listAssets,
    upload: uploadAsset,
    delete: deleteAsset,
  },
}
