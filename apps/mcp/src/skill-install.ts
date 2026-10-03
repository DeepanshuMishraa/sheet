import { access, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic } from './agent-install'
import { SKILL_FILES, SKILL_NAME } from './skill-files'

type SkillTarget = {
  /** Who reads this folder. */
  label: string
  skillsDir: string
  /** Install only if this folder exists, i.e. the tool is on this machine. `null`: always. */
  requires: string | null
}

export type SkillInstallEntry =
  | { label: string; path: string; status: 'installed' | 'updated' }
  | { label: string; path: string; status: 'skipped'; message: string }
  | { label: string; path: string; status: 'failed'; message: string }

function targets(home: string): SkillTarget[] {
  return [
    { label: 'Shared agents folder (Codex, OpenCode, Copilot, Cursor)', skillsDir: join(home, '.agents', 'skills'), requires: null },
    { label: 'Claude Code', skillsDir: join(home, '.claude', 'skills'), requires: join(home, '.claude') },
    { label: 'Cursor', skillsDir: join(home, '.cursor', 'skills'), requires: join(home, '.cursor') },
    { label: 'Codex', skillsDir: join(home, '.codex', 'skills'), requires: join(home, '.codex') },
    { label: 'OpenCode', skillsDir: join(home, '.config', 'opencode', 'skills'), requires: join(home, '.config', 'opencode') },
    { label: 'Copilot', skillsDir: join(home, '.copilot', 'skills'), requires: join(home, '.copilot') },
    { label: 'Antigravity', skillsDir: join(home, '.gemini', 'antigravity', 'skills'), requires: join(home, '.gemini', 'antigravity') },
  ]
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Copies the Sheet design skill into every agent skills folder found on this
 * machine. An older copy is replaced whole so retired reference files do not
 * linger and contradict the new ones.
 */
export async function installSkill(home = homedir()): Promise<SkillInstallEntry[]> {
  const results: SkillInstallEntry[] = []
  for (const target of targets(home)) {
    const path = join(target.skillsDir, SKILL_NAME)
    if (target.requires !== null && !(await exists(target.requires))) {
      results.push({ label: target.label, path, status: 'skipped', message: 'Not installed on this machine.' })
      continue
    }
    try {
      const existed = await exists(path)
      await rm(path, { recursive: true, force: true })
      for (const file of SKILL_FILES) await writeAtomic(join(path, file.path), file.content)
      results.push({ label: target.label, path, status: existed ? 'updated' : 'installed' })
    } catch (error) {
      results.push({
        label: target.label,
        path,
        status: 'failed',
        message: `Could not write ${path} (${error instanceof Error ? error.message : 'unknown error'}). Check the folder's permissions, then try again.`,
      })
    }
  }
  return results
}
