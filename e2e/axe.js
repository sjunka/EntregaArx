import { expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export async function sinViolaciones(page, nombre) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`), `axe en ${nombre}`).toEqual([])
}
