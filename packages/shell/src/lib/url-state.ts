import {
  createStandardSchemaV1,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs'

export const SETTINGS_TABS = ['appearance', 'shortcuts'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const editorSearchParams = {
  d: parseAsString,
  draft: parseAsString,
  settings: parseAsStringLiteral(SETTINGS_TABS),
  layers: parseAsBoolean.withDefault(false),
  assets: parseAsBoolean.withDefault(false),
  history: parseAsBoolean.withDefault(false),
  code: parseAsBoolean.withDefault(false),
}

export const designSearchParams = {
  ...editorSearchParams,
  node: parseAsString,
  page: parseAsString,
  instancePath: parseAsString,
}

export const designValidateSearch = createStandardSchemaV1(designSearchParams, {
  partialOutput: true,
})

export const legacyDesignValidateSearch = createStandardSchemaV1(
  {
    ...designSearchParams,
    id: parseAsString,
  },
  {
    partialOutput: true,
  },
)
