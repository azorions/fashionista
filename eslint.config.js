const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'supabase/functions/*'],
  },
  {
    // THE PURITY BOUNDARY.
    //
    // src/domain is pure TypeScript: quality scoring, colour maths, the tag
    // schema, and (milestone 2) the whole styling engine. Keeping react-native
    // and expo-* out of it is what lets `npm test` run the real logic in ~2s in
    // plain Node on Windows, with no Metro, no simulator and no phone attached.
    //
    // Retrofitting this later means untangling expo imports out of the engine,
    // which is why it lands on day one. If you need a native API, put the
    // impure adapter in src/lib/ and have it hand plain data across.
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/domain must stay pure — no React. Put UI in src/app or src/components.' },
            { name: 'react-native', message: 'src/domain must stay pure — no react-native. Put the adapter in src/lib/.' },
            { name: '@supabase/supabase-js', message: 'src/domain must stay pure — no network. Take data as a function argument.' },
          ],
          patterns: [
            { group: ['expo', 'expo-*', 'expo/*'], message: 'src/domain must stay pure — no expo-*. Put the adapter in src/lib/.' },
            { group: ['@/lib/*', '@/app/*', '@/components/*'], message: 'src/domain must not depend on impure layers.' },
          ],
        },
      ],
    },
  },
]);
