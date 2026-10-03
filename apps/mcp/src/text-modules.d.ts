/** Markdown files imported with `with { type: 'text' }` are embedded as strings by Bun. */
declare module '*.md' {
  const text: string
  export default text
}
