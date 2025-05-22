import { test, expect } from '@playwright/test'

test.describe('Realtime Connection', () => {
  test('should connect and show connected status', async ({ page }) => {
    // Navigate to the example page
    await page.goto('http://localhost:8000')

    // Get initial state
    const status = await page.locator('#status')
    await expect(status).toHaveText('Disconnected')

    // Click connect button
    const connectButton = await page.locator('#toggleConnection')
    await connectButton.click()

    // Wait for status to change to Connected
    // We'll wait up to 10 seconds for the connection to establish
    await expect(async () => {
      const currentStatus = await status.textContent()
      expect(currentStatus).toBe('Connected')
    }).toPass({
      timeout: 10000,
      intervals: [1000] // Check every second
    })

    // Verify button state changed
    await expect(connectButton).toHaveText('Disconnect')
    await expect(connectButton).toHaveClass(/disconnect/)

    // Verify message was added
    const messages = await page.locator('#messages div').first()
    await expect(messages).toContainText('Connected to Supabase Realtime')
  })

  test('should disconnect and show disconnected status', async ({ page }) => {
    // Navigate to the example page
    await page.goto('http://localhost:8000')

    // Connect first
    const connectButton = await page.locator('#toggleConnection')
    await connectButton.click()

    // Wait for connection
    const status = await page.locator('#status')
    await expect(async () => {
      const currentStatus = await status.textContent()
      expect(currentStatus).toBe('Connected')
    }).toPass({
      timeout: 10000,
      intervals: [1000]
    })

    // Click disconnect
    await connectButton.click()

    // Wait for status to change to Disconnected
    await expect(async () => {
      const currentStatus = await status.textContent()
      expect(currentStatus).toBe('Disconnected')
    }).toPass({
      timeout: 10000,
      intervals: [1000]
    })

    // Verify button state changed
    await expect(connectButton).toHaveText('Connect')
    await expect(connectButton).toHaveClass(/connect/)

    // Verify message was added
    const messages = await page.locator('#messages div').first()
    await expect(messages).toContainText('Disconnected from Supabase Realtime')
  })
}) 