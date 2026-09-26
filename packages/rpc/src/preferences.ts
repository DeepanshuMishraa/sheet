import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@sheet/db'
import { userPreferences } from '@sheet/db/schema'
import { EMPTY_SHORTCUT_CONFIG } from '@sheet/db/shortcuts'
import { parseShortcutConfig, shortcutConfigSchema } from './shortcuts'
import { localProcedure } from './procedures'

/**
 * The `preferences` namespace: per-account editor settings.
 */

export const getPreferences = localProcedure.handler(async ({ context }) => {
  const [row] = await db
    .select({ shortcuts: userPreferences.shortcuts })
    .from(userPreferences)
    .where(eq(userPreferences.userId, context.user.id))
    .limit(1)
  return {
    shortcuts: row ? parseShortcutConfig(row.shortcuts) : EMPTY_SHORTCUT_CONFIG,
  }
})

export const savePreferences = localProcedure
  .input(z.object({ shortcuts: shortcutConfigSchema }))
  .handler(async ({ context, input }) => {
    const shortcuts = parseShortcutConfig(input.shortcuts)
    await db
      .insert(userPreferences)
      .values({
        userId: context.user.id,
        shortcuts,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          shortcuts,
          updatedAt: new Date(),
        },
      })
    return { shortcuts }
  })
