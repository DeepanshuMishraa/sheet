import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AGENTS, ConnectAgent, MCP_URL } from './connect-agent'

describe('ConnectAgent', () => {
  it('shows a brand logo and setup steps for every agent', () => {
    const view = render(<ConnectAgent />)
    for (const agent of AGENTS) {
      fireEvent.click(view.getByRole('tab', { name: agent.name }))
      expect(view.getAllByText(new RegExp(`${MCP_URL.replace(/[/.]/g, '\\$&')}`)).length).toBeGreaterThan(0)
    }
    // Every tab carries an svg mark.
    const withLogo = view.getAllByRole('tab').filter((tab) => tab.querySelector('svg path[d^="M"]'))
    expect(withLogo.length).toBe(AGENTS.length)
  })
})
