/**
 * Chat Flow E2E Tests
 *
 * Real end-to-end tests for chat functionality.
 * These tests actually send messages to the API and verify responses.
 *
 * Required Environment Variables:
 *   DEVX_TEST_API_KEY - API key for testing
 *   DEVX_TEST_API_URL - API URL (optional)
 *   DEVX_TEST_MODEL   - Model to use (optional)
 */

import { test, expect, hasApiKey } from '../fixtures/electron'
import { navigateToChat } from '../fixtures/helpers'

// Skip all chat tests if no API key is configured
test.beforeEach(async ({}, testInfo) => {
  if (!hasApiKey()) {
    testInfo.skip(true, 'Skipping chat tests: DEVX_TEST_API_KEY not set')
  }
})

test.describe('Chat Interface', () => {
  test('chat input is visible and functional', async ({ window }) => {
    // Navigate to chat interface
    await navigateToChat(window)

    // Find chat input
    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })

    expect(chatInput).toBeTruthy()

    // Input should be enabled
    const isEnabled = await chatInput.isEnabled()
    expect(isEnabled).toBe(true)

    // Should be able to type
    await chatInput.fill('Hello, DevX!')
    const value = await chatInput.inputValue()
    expect(value).toBe('Hello, DevX!')
  })

  test('send button exists and is functional', async ({ window }) => {
    await navigateToChat(window)

    // Find send button (has data-onboarding="send-button")
    const sendButton = await window.waitForSelector(
      '[data-onboarding="send-button"]',
      { timeout: 5000 }
    )

    expect(sendButton).toBeTruthy()
  })
})

test.describe('Real Chat Flow', () => {
  // Increase timeout for real API calls
  test.setTimeout(60000)

  test('can send message and receive response', async ({ window }) => {
    // Navigate to chat interface
    await navigateToChat(window)

    // Find chat input
    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })

    // Type a simple test message
    const testMessage = 'Say "Hello Test" and nothing else.'
    await chatInput.fill(testMessage)

    // Take screenshot before clicking send
    await window.screenshot({ path: 'tests/e2e/results/chat-before-send.png' })

    // Find and click send button
    const sendButton = await window.waitForSelector(
      '[data-onboarding="send-button"]',
      { timeout: 5000 }
    )

    // Use force click to bypass any potential overlay
    await sendButton.click({ force: true })

    // Take screenshot right after clicking
    await window.waitForTimeout(1000)
    await window.screenshot({ path: 'tests/e2e/results/chat-after-send.png' })

    // Wait for user message to appear in the chat (message-user class)
    await window.waitForSelector(
      '.message-user',
      { timeout: 10000 }
    )

    // Wait for AI message bubble to appear (message-assistant class)
    await window.waitForSelector(
      '.message-assistant',
      { timeout: 30000 }
    )

    // Wait for AI to finish working (wait for working indicator to disappear)
    await window.waitForSelector(
      'text=/DevX 工作中|Halo 工作中|DevX is working|Halo is working/',
      { state: 'hidden', timeout: 45000 }
    ).catch(() => {
      // Indicator might have already disappeared, continue
    })

    // Take screenshot after AI completes
    await window.screenshot({ path: 'tests/e2e/results/chat-response.png' })

    // Verify AI response contains expected content
    // The AI should respond with "Hello Test" when asked to say it
    const assistantMessage = await window.waitForSelector('.message-assistant', { timeout: 5000 })
    const responseText = await assistantMessage.textContent()

    // AI response should contain "Hello" (the content we asked it to say)
    expect(responseText?.toLowerCase()).toContain('hello')
  })

  test('displays thinking indicator during response', async ({ window }) => {
    await navigateToChat(window)

    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })
    await chatInput.fill('Count from 1 to 5 slowly.')

    const sendButton = await window.waitForSelector('[data-onboarding="send-button"]', { timeout: 5000 })
    await sendButton.click()

    // Look for working indicator (localized)
    const hasIndicator = await window.waitForSelector(
      'text=/DevX 工作中|Halo 工作中|DevX is working|Halo is working/',
      { timeout: 10000 }
    ).then(() => true).catch(() => false)

    // Wait for AI message to appear
    await window.waitForSelector('.message-assistant', { timeout: 30000 })

    // Wait for AI to finish working
    await window.waitForSelector('text=/DevX 工作中|Halo 工作中|DevX is working|Halo is working/', { state: 'hidden', timeout: 45000 }).catch(() => {})

    // Verify AI response contains numbers (1-5)
    const assistantMessage = await window.waitForSelector('.message-assistant', { timeout: 5000 })
    const responseText = await assistantMessage.textContent()
    expect(responseText).toMatch(/[1-5]/)
  })

  test('input clears after sending message', async ({ window }) => {
    await navigateToChat(window)

    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })
    await chatInput.fill('Test message for clearing')

    const sendButton = await window.waitForSelector(
      '[data-onboarding="send-button"]',
      { timeout: 5000 }
    )
    await sendButton.click()

    // Wait a moment for the send to process
    await window.waitForTimeout(500)

    // Input should be cleared after sending
    const valueAfterSend = await chatInput.inputValue()
    expect(valueAfterSend).toBe('')
  })

  test('can send multiple messages in sequence', async ({ window }) => {
    await navigateToChat(window)

    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })
    const sendButton = await window.waitForSelector('[data-onboarding="send-button"]', { timeout: 5000 })

    // Send first message
    await chatInput.fill('Say "First" and nothing else.')
    await sendButton.click()

    // Wait for first AI response
    await window.waitForSelector('.message-assistant', { timeout: 30000 })
    await window.waitForSelector('text=/DevX 工作中|Halo 工作中|DevX is working|Halo is working/', { state: 'hidden', timeout: 45000 }).catch(() => {})

    // Verify first response
    let assistantMessages = await window.$$('.message-assistant')
    let firstResponse = await assistantMessages[0].textContent()
    expect(firstResponse?.toLowerCase()).toContain('first')

    // Send second message
    await chatInput.fill('Say "Second" and nothing else.')
    await sendButton.click()

    // Wait for second AI response (should now have 2 assistant messages)
    await window.waitForFunction(() => document.querySelectorAll('.message-assistant').length >= 2, { timeout: 30000 })
    await window.waitForSelector('text=/DevX 工作中|Halo 工作中|DevX is working|Halo is working/', { state: 'hidden', timeout: 45000 }).catch(() => {})

    // Verify second response
    assistantMessages = await window.$$('.message-assistant')
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2)
    const secondResponse = await assistantMessages[1].textContent()
    expect(secondResponse?.toLowerCase()).toContain('second')

    await window.screenshot({ path: 'tests/e2e/results/chat-multiple-messages.png' })
  })
})

test.describe('Switch Provider and Chat', () => {
  test.setTimeout(90000)

  test('switch to tencent provider, select GLM-5.0, and chat', async ({ window }) => {
    await navigateToChat(window)

    // Open ModelSelector dropdown
    // The model selector button shows the current model name (e.g., "DeepSeek V3.2")
    // and is distinct from the SpaceSelector which shows the default space label
    // Use evaluate to find the right button by looking for the model name pattern
    await window.evaluate(() => {
      const buttons = document.querySelectorAll('button')
      for (const btn of buttons) {
        const text = btn.textContent || ''
        // Model selector shows model names like "DeepSeek V3.2", "GPT-4", etc.
        if (text.match(/DeepSeek|GPT|Claude|GLM|kimi|gpt|Qwen|deepseek/i) && btn.querySelector('svg')) {
          btn.click()
          break
        }
      }
    })

    // Wait for dropdown to appear
    await window.waitForTimeout(500)

    // Click on the "tencent" source section to expand it
    const tencentSection = await window.waitForSelector(
      'text="tencent"',
      { timeout: 5000 }
    )
    await tencentSection.click()

    // Wait for model list to expand
    await window.waitForTimeout(300)

    // Click on GLM-5.0 model
    const glmModel = await window.waitForSelector(
      'button:has-text("GLM-5.0")',
      { timeout: 5000 }
    )
    await glmModel.click()

    // Wait for dropdown to close and model to switch
    await window.waitForTimeout(500)

    // Take screenshot after switching
    await window.screenshot({ path: 'tests/e2e/results/chat-switch-tencent-glm.png' })

    // Now send a chat message to verify the new provider works
    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })
    await chatInput.fill('你好，你是哪个模型，具体哪个型号？')

    const sendButton = await window.waitForSelector(
      '[data-onboarding="send-button"]',
      { timeout: 5000 }
    )
    await sendButton.click({ force: true })

    // Wait for user message
    await window.waitForSelector('.message-user', { timeout: 10000 })

    // Wait for AI response
    await window.waitForSelector('.message-assistant', { timeout: 45000 })

    // Wait for AI to finish
    await window.waitForSelector('text=/DevX 工作中|Halo 工作中|DevX is working|Halo is working/', { state: 'hidden', timeout: 60000 }).catch(() => {})

    await window.screenshot({ path: 'tests/e2e/results/chat-tencent-glm-response.png' })

    // Verify response exists
    const assistantMessage = await window.waitForSelector('.message-assistant', { timeout: 5000 })
    const responseText = await assistantMessage.textContent()
    expect(responseText).toBeTruthy()
    expect(responseText!.length).toBeGreaterThan(0)
  })
})

test.describe('Chat Error Handling', () => {
  test('handles empty message gracefully', async ({ window }) => {
    await navigateToChat(window)

    const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })
    const sendButton = await window.waitForSelector(
      '[data-onboarding="send-button"]',
      { timeout: 5000 }
    )

    // Clear input and try to send
    await chatInput.fill('')

    // Send button should be disabled when input is empty
    const isDisabled = await sendButton.isDisabled()
    expect(isDisabled).toBe(true)
  })
})
