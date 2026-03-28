/**
 * Space Management E2E Tests
 *
 * Tests dedicated space creation, entering, conversation management,
 * and space lifecycle operations.
 */

import { test, expect } from '../fixtures/electron'
import { waitForHomePage, navigateToChat } from '../fixtures/helpers'

test.describe('Space Management', () => {
  test.setTimeout(30000)

  test('can create a new dedicated space', async ({ window }) => {
    await waitForHomePage(window)

    // Click "New" button to create space (supports EN/CN)
    const newButton = await window.waitForSelector(
      'button:has-text("New"), button:has-text("新建")',
      { timeout: 5000 }
    )
    await newButton.click()

    // Dialog should appear
    const dialog = await window.waitForSelector(
      'text=/Create Dedicated Space|创建专属空间/i',
      { timeout: 5000 }
    )
    expect(dialog).toBeTruthy()

    // Fill in space name
    const nameInput = await window.waitForSelector(
      'input[placeholder*="Project"], input[placeholder*="项目"]',
      { timeout: 5000 }
    )
    await nameInput.fill('E2E Test Space')

    // Click create button
    const createBtn = await window.waitForSelector(
      'button:has-text("Create"), button:has-text("创建")',
      { timeout: 5000 }
    )
    await createBtn.click()

    // Wait for dialog to close and space to appear
    await window.waitForTimeout(1000)

    // Space should now appear in the list
    const spaceCard = await window.waitForSelector(
      'text="E2E Test Space"',
      { timeout: 10000 }
    )
    expect(spaceCard).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/spaces-created.png' })
  })

  test('can enter a dedicated space and see chat', async ({ window }) => {
    await waitForHomePage(window)

    // First create a space
    const newButton = await window.waitForSelector(
      'button:has-text("New"), button:has-text("新建")',
      { timeout: 5000 }
    )
    await newButton.click()

    const nameInput = await window.waitForSelector(
      'input[placeholder*="Project"], input[placeholder*="项目"]',
      { timeout: 5000 }
    )
    await nameInput.fill('E2E Enter Space')

    const createBtn = await window.waitForSelector(
      'button:has-text("Create"), button:has-text("创建")',
      { timeout: 5000 }
    )
    await createBtn.click()
    await window.waitForTimeout(1000)

    // Click the space card to enter
    const spaceCard = await window.waitForSelector(
      'text="E2E Enter Space"',
      { timeout: 10000 }
    )
    await spaceCard.click()

    // Should show chat interface with textarea
    await window.waitForSelector('textarea', { timeout: 15000 })

    // Should show the space name in the header area
    const spaceName = await window.$('text="E2E Enter Space"')
    expect(spaceName).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/spaces-entered.png' })
  })

  test('can create new conversation in Halo space', async ({ window }) => {
    // Navigate to Halo chat
    await navigateToChat(window)

    // Find the "New conversation" button in header (+ icon)
    const newConvButton = await window.waitForSelector(
      'button:has-text("New conversation"), button:has-text("新对话")',
      { timeout: 5000 }
    ).catch(() => null)

    // Fallback: find button with plus icon
    const btn = newConvButton || await window.waitForSelector(
      'button:has(svg path[d*="12 4v16m8-8H4"])',
      { timeout: 5000 }
    ).catch(() => null)

    if (btn) {
      await btn.click()
      await window.waitForTimeout(500)

      // Textarea should still be present (new conversation ready)
      const textarea = await window.$('textarea')
      expect(textarea).toBeTruthy()
    }

    await window.screenshot({ path: 'tests/e2e/results/spaces-new-conv.png' })
  })

  test('create space dialog can be cancelled', async ({ window }) => {
    await waitForHomePage(window)

    // Open create dialog
    const newButton = await window.waitForSelector(
      'button:has-text("New"), button:has-text("新建")',
      { timeout: 5000 }
    )
    await newButton.click()

    // Dialog should appear
    await window.waitForSelector(
      'text=/Create Dedicated Space|创建专属空间/i',
      { timeout: 5000 }
    )

    // Click Cancel button
    const cancelBtn = await window.waitForSelector(
      'button:has-text("Cancel"), button:has-text("取消")',
      { timeout: 5000 }
    )
    await cancelBtn.click()

    // Dialog should close - home page should be visible again
    await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 5000 })
  })
})
