import { describe, expect, it } from 'vitest'
import { resolveBackgroundDispatchUrl } from '../netlify/functions/governed-review-prepare.js'

describe('governed review background dispatch URL', () => {
  it('uses the authenticated request origin for the server-side worker dispatch', () => {
    expect(resolveBackgroundDispatchUrl({ rawUrl: 'https://atlas-market.netlify.app/.netlify/functions/governed-review-prepare' }, {}))
      .toBe('https://atlas-market.netlify.app/.netlify/functions/governed-review-prepare-background')
  })

  it('requires a deploy origin instead of issuing an invalid relative server fetch', () => {
    expect(() => resolveBackgroundDispatchUrl({}, {})).toThrow('Background dispatch origin is unavailable.')
  })
})
