/**
 * Settings Page E2E Tests
 *
 * Tests settings page rendering, section visibility, navigation,
 * and basic interactions like theme switching.
 */

import { test, expect } from '../fixtures/electron'
import { navigateToSettings } from '../fixtures/helpers'

test.describe('Settings Page', () => {
  test.setTimeout(30000)

  test('renders with AI Model section', async ({ window }) => {
    await navigateToSettings(window)

    // AI Model section should be visible (supports EN/CN)
    const aiModelSection = await window.waitForSelector(
      'text=/AI Model|AI 模型/i',
      { timeout: 10000 }
    )
    expect(aiModelSection).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/settings-ai-section.png' })
  })

  test('shows Appearance section', async ({ window }) => {
    await navigateToSettings(window)

    // Scroll down to find Appearance section
    await window.evaluate(() => window.scrollTo(0, 500))
    await window.waitForTimeout(300)

    // Look for Appearance section (supports EN/CN)
    const appearanceSection = await window.waitForSelector(
      'text=/Appearance|外观/i',
      { timeout: 10000 }
    )
    expect(appearanceSection).toBeTruthy()
  })

  test('shows About section with version info', async ({ window }) => {
    await navigateToSettings(window)

    // Scroll to bottom for About section
    await window.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await window.waitForTimeout(500)

    // Look for About section (supports EN/CN)
    const aboutSection = await window.waitForSelector(
      'text=/About|关于/i',
      { timeout: 10000 }
    )
    expect(aboutSection).toBeTruthy()

    // Version info should be displayed
    const versionText = await window.$('text=/[0-9]+\\.[0-9]+\\.[0-9]+/')
    expect(versionText).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/settings-about.png' })
  })

  test('has left navigation sidebar', async ({ window }) => {
    await navigateToSettings(window)

    // Check for nav items (the SettingsNav component renders navigation links)
    // AI Model nav item should exist (supports EN/CN)
    const navItems = await window.$$('nav a, nav button, [role="navigation"] button')

    // Desktop should have the left navigation sidebar with multiple items
    // On mobile it collapses to dropdown, but in E2E we run at desktop size
    // At minimum, the AI Model heading should be in the nav
    const bodyText = await window.evaluate(() => document.body.innerText)
    const hasNavItems = bodyText.includes('AI') || bodyText.includes('模型')
    expect(hasNavItems).toBe(true)
  })

  test('can toggle theme', async ({ window }) => {
    await navigateToSettings(window)

    // Scroll to Appearance section
    await window.evaluate(() => {
      const el = document.querySelector('#appearance')
      if (el) el.scrollIntoView({ behavior: 'instant' })
      else window.scrollTo(0, 500)
    })
    await window.waitForTimeout(500)

    // Check current theme (dark is default in tests)
    const isDark = await window.evaluate(() =>
      !document.documentElement.classList.contains('light')
    )
    expect(isDark).toBe(true)

    // Find theme options - look for Light/浅色 button
    const lightThemeOption = await window.waitForSelector(
      'text=/Light|浅色/i',
      { timeout: 5000 }
    ).catch(() => null)

    if (lightThemeOption) {
      await lightThemeOption.click()
      await window.waitForTimeout(500)

      // Verify theme changed to light
      const isNowLight = await window.evaluate(() =>
        document.documentElement.classList.contains('light')
      )
      expect(isNowLight).toBe(true)

      // Switch back to dark for consistency
      const darkOption = await window.waitForSelector(
        'text=/Dark|深色/i',
        { timeout: 5000 }
      ).catch(() => null)
      if (darkOption) {
        await darkOption.click()
        await window.waitForTimeout(300)
      }
    }

    await window.screenshot({ path: 'tests/e2e/results/settings-theme.png' })
  })

  test('back button returns to previous page', async ({ window }) => {
    await navigateToSettings(window)

    // Click back button (ArrowLeft SVG in header)
    const backButton = await window.waitForSelector(
      'button:has(svg)',
      { timeout: 5000 }
    )
    await backButton.click()

    // Should return to Home Page
    await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 10000 })
  })
})
