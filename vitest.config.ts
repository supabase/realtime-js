import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    coverage: {
      exclude: [
        ...configDefaults.exclude,
        'index.ts',
        './example/*',
        './docs/*',
      ],
    },
    environment: 'jsdom',
  },
})