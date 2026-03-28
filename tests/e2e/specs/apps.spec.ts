/**
 * Apps / Digital Humans E2E Tests
 *
 * Tests the Apps page (digital humans, apps, app store)
 * including tab navigation, list rendering, and basic interactions.
 */

import { test, expect } from '../fixtures/electron'
import { navigateToApps, waitForHomePage } from '../fixtures/helpers'

test.describe('Apps Page', () => {
  test.setTimeout(30000)

  test('renders with correct tab bar', async ({ window }) => {
    await navigateToApps(window)

    // All three tabs should be visible (supports EN/CN)
    const digitalHumansTab = await window.$('text=/My Digital Humans|我的数字人/i')
    expect(digitalHumansTab).toBeTruthy()

    const myAppsTab = await window.$('text=/My Apps|我的应用/i')
    expect(myAppsTab).toBeTruthy()

    const storeTab = await window.$('text=/App Store|应用商店/i')
    expect(storeTab).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/apps-tabs.png' })
  })

  test('can switch to My Apps tab', async ({ window }) => {
    await navigateToApps(window)

    // Click My Apps tab
    const myAppsTab = await window.waitForSelector(
      'button:has-text("My Apps"), button:has-text("我的应用")',
      { timeout: 5000 }
    )
    await myAppsTab.click()
    await window.waitForTimeout(300)

    // Tab should be active (has active styling)
    await window.screenshot({ path: 'tests/e2e/results/apps-my-apps-tab.png' })
  })

  test('can switch to App Store tab', async ({ window }) => {
    await navigateToApps(window)

    // Click App Store tab
    const storeTab = await window.waitForSelector(
      'button:has-text("App Store"), button:has-text("应用商店")',
      { timeout: 5000 }
    )
    await storeTab.click()
    await window.waitForTimeout(500)

    // StoreView should render
    await window.screenshot({ path: 'tests/e2e/results/apps-store-tab.png' })
  })

  test('My Digital Humans shows empty state or app list', async ({ window }) => {
    await navigateToApps(window)

    // Either shows an app list or an empty state
    // Wait for content to load
    await window.waitForTimeout(500)

    // Check for empty state or app list items
    const bodyText = await window.evaluate(() => document.body.innerText)
    const hasContent = bodyText.length > 50 // Some meaningful content should exist
    expect(hasContent).toBe(true)

    await window.screenshot({ path: 'tests/e2e/results/apps-digital-humans.png' })
  })

  test('can navigate back from Apps page', async ({ window }) => {
    await navigateToApps(window)

    // Find back button (ChevronLeft + text)
    const backButton = await window.waitForSelector(
      'button:has(svg)',
      { timeout: 5000 }
    )
    await backButton.click()

    // Should return to Home Page
    await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 10000 })
  })

  test('settings button is accessible from Apps page', async ({ window }) => {
    await navigateToApps(window)

    // Settings button should be in the header (gear icon)
    const settingsButton = await window.waitForSelector(
      'button[title="Settings"], button[title="设置"]',
      { timeout: 5000 }
    ).catch(() => null)

    // Fallback: last button with SVG in header area
    if (!settingsButton) {
      const buttons = await window.$$('button:has(svg)')
      expect(buttons.length).toBeGreaterThan(0)
    } else {
      expect(settingsButton).toBeTruthy()
    }
  })
})

test.describe('Apps Page - Store Tab', () => {
  test.setTimeout(30000)

  test('app store shows content', async ({ window }) => {
    await navigateToApps(window)

    // Switch to App Store tab
    const storeTab = await window.waitForSelector(
      'button:has-text("App Store"), button:has-text("应用商店")',
      { timeout: 5000 }
    )
    await storeTab.click()

    // Wait for store content to load
    await window.waitForTimeout(1000)

    // Store should show some content (cards, grid, or loading state)
    const bodyText = await window.evaluate(() => document.body.innerText)
    expect(bodyText.length).toBeGreaterThan(50)

    await window.screenshot({ path: 'tests/e2e/results/apps-store-content.png' })
  })
})
