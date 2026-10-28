const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([
 expo,
 { ignores: ['dist/**', 'artifacts/**', 'node_modules/**', 'tests/**', 'scripts/**'] },
 // Imperative native lifecycles, initial fetches, and route-key resets intentionally synchronize local state in effects.
 { rules: { 'react-hooks/set-state-in-effect': 'off', '@typescript-eslint/no-unused-vars': 'off', 'react-hooks/exhaustive-deps': 'off', 'react/no-unescaped-entities': 'off', 'import/no-named-as-default': 'off', 'import/no-named-as-default-member': 'off' } },
]);
