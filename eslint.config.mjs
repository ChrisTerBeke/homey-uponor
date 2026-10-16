// ESLint flat config (ESLint 9+/10 no longer supports .eslintrc).
// Behaviour is kept equivalent to the previous .eslintrc.json: the legacy
// eslint-config-athom preset is loaded through FlatCompat, and fixupConfigRules
// shims the legacy plugins (eslint-plugin-node, eslint-plugin-import) that still
// use context APIs removed in ESLint 9+.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FlatCompat } from '@eslint/eslintrc';
import { fixupConfigRules, includeIgnoreFile } from '@eslint/compat';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const compat = new FlatCompat({
  baseDirectory: dirname,
  // The preset's plugins are installed nested under eslint-config-athom.
  resolvePluginsRelativeTo: path.dirname(require.resolve('eslint-config-athom/package.json')),
});

export default [
  // Previously: --ignore-path .gitignore
  includeIgnoreFile(path.join(dirname, '.gitignore')),
  { ignores: ['eslint.config.mjs'] },
  ...fixupConfigRules(compat.extends('athom')).map((config) => (config.files ? config : {
    ...config,
    // Previously: --ext .js,.ts,.mts
    files: ['**/*.js', '**/*.ts', '**/*.mts'],
  })),
  {
    files: ['**/*.js', '**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      strict: 'off',
      'node/no-unsupported-features/es-syntax': 'off',
      'node/no-missing-import': 'off',
      'node/no-unpublished-import': 'off',
      'import/no-unresolved': 'off',
      'import/extensions': 'off',
      'no-use-before-define': 'off',
      'import/prefer-default-export': 'off',
      'max-classes-per-file': 'off',
      'prefer-arrow-callback': 'off',
      'func-names': 'off',
      // ESLint 9 changed the default of caughtErrors from 'none' to 'all';
      // keep the eslint-config-athom (ESLint 8) behaviour.
      'no-unused-vars': ['error', {
        vars: 'all', args: 'none', ignoreRestSiblings: true, caughtErrors: 'none',
      }],
    },
  },
];
