import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import jsdoc from 'eslint-plugin-jsdoc';
import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
	{
		ignores: ['node_modules/**', 'dist/**', 'build/**', 'src/data-grabber/python/public/*.json'],
	},
	js.configs.recommended,
	{
		files: ['**/*.{js,jsx}'],
		linterOptions: {
			reportUnusedDisableDirectives: 'warn',
		},
		settings: {
			'import/resolver': {
				node: {
					extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'],
				},
				typescript: true,
			},
		},
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				ecmaVersion: 'latest',
				ecmaFeatures: {
					jsx: true,
				},
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			import: importPlugin,
			jsdoc,
			'react-hooks': reactHooks,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'no-unused-expressions': [
				'error',
				{
					allowTernary: true,
				},
			],
			'no-console': 'warn',
			'no-empty': 'error',
			'no-useless-assignment': 'error',
			'no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'import/no-unresolved': [
				'error',
				{
					ignore: ['^@wordpress/', '\\?url$'],
				},
			],
			'import/no-extraneous-dependencies': 'off',
			'jsdoc/check-param-names': 'error',
			'jsdoc/check-property-names': 'error',
			'jsdoc/check-tag-names': 'error',
			'jsdoc/require-param': 'off',
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/static-components': 'error',
			'react-hooks/exhaustive-deps': 'error',
		},
	},
	{
		files: ['**/*.{ts,tsx}'],
		linterOptions: {
			reportUnusedDisableDirectives: 'warn',
		},
		settings: {
			'import/resolver': {
				node: {
					extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'],
				},
				typescript: true,
			},
		},
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 'latest',
				ecmaFeatures: {
					jsx: true,
				},
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			import: importPlugin,
			'@typescript-eslint': tsPlugin,
			'react-hooks': reactHooks,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			...tsPlugin.configs.recommended.rules,
			'no-unused-expressions': [
				'error',
				{
					allowTernary: true,
				},
			],
			'no-console': 'warn',
			'no-empty': 'error',
			'no-useless-assignment': 'error',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'import/no-unresolved': [
				'error',
				{
					ignore: ['^@wordpress/', '\\?url$'],
				},
			],
			'import/no-extraneous-dependencies': 'off',
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/static-components': 'error',
			'react-hooks/exhaustive-deps': 'error',
		},
	},
];
