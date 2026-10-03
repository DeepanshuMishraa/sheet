import skillMd from '../../../skills/sheet-design-guide/SKILL.md' with { type: 'text' }
import openaiYaml from '../../../skills/sheet-design-guide/agents/openai.yaml' with { type: 'text' }
import designCraft from '../../../skills/sheet-design-guide/references/design-craft.md' with { type: 'text' }
import toolWorkflows from '../../../skills/sheet-design-guide/references/tool-workflows.md' with { type: 'text' }
import webAuthoring from '../../../skills/sheet-design-guide/references/web-authoring.md' with { type: 'text' }
import webSchema from '../../../skills/sheet-design-guide/references/web-schema.md' with { type: 'text' }
import workedExamples from '../../../skills/sheet-design-guide/references/worked-examples.md' with { type: 'text' }

export const SKILL_NAME = 'sheet-design-guide'

/** The skill folder, embedded so the compiled sidecar can install it without the repo. */
export const SKILL_FILES: ReadonlyArray<{ path: string; content: string }> = [
  { path: 'SKILL.md', content: skillMd },
  { path: 'agents/openai.yaml', content: openaiYaml },
  { path: 'references/design-craft.md', content: designCraft },
  { path: 'references/tool-workflows.md', content: toolWorkflows },
  { path: 'references/web-authoring.md', content: webAuthoring },
  { path: 'references/web-schema.md', content: webSchema },
  { path: 'references/worked-examples.md', content: workedExamples },
]
