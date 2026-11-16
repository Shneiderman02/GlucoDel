import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {ignores: ['dist', 'node_modules', 'playwright-report', 'test-results']},
  {files: ['**/*.{ts,tsx}'], extends: [eslint.configs.recommended, ...tseslint.configs.recommended], plugins: {'react-hooks': hooks}, rules: hooks.configs.recommended.rules},
)
