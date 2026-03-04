import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const pythonPublicDir = 'data-grabber/python/public';
const pyodideModuleDir = '../node_modules/pyodide';
const pyodideDestDir = 'pyodide';

export default defineConfig(({ command }) => {
	const isDevServer = command === 'serve';
	const staticCopyTargets = [
		{
			src: `${pythonPublicDir}/demo_mewgenics_cats.json`,
			dest: '.',
		},
		{
			src: 'data-grabber/python/parse_save.py',
			dest: '.',
		},
		{
			src: `${pyodideModuleDir}/pyodide.asm.js`,
			dest: pyodideDestDir,
		},
		{
			src: `${pyodideModuleDir}/pyodide.asm.wasm`,
			dest: pyodideDestDir,
		},
		{
			src: `${pyodideModuleDir}/python_stdlib.zip`,
			dest: pyodideDestDir,
		},
		{
			src: `${pyodideModuleDir}/pyodide-lock.json`,
			dest: pyodideDestDir,
		},
		{
			src: `${pythonPublicDir}/pyodide-packages/*.whl`,
			dest: 'pyodide-packages',
		},
	];

	if (isDevServer) {
		staticCopyTargets.unshift({
			src: `${pythonPublicDir}/mewgenics_cats.json`,
			dest: '.',
		});
	}

	return {
		base: '/mewgenics-visual-cat-organizer/',
		define: {
			'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
		},
		plugins: [
			react(),
			viteStaticCopy({
				targets: staticCopyTargets,
			}),
		],
		root: 'src',
		build: {
			outDir: '../dist',
			emptyOutDir: true,
			reportCompressedSize: false,
		},
		publicDir: false, // Disable default publicDir, use static copy instead
	};
});
