import { loadPyodide } from 'pyodide';

let pyodideRuntimePromise;
const SQLITE3_WHEEL_FILE = 'sqlite3-1.0.0-cp313-cp313-pyodide_2025_0_wasm32.whl';

async function initializePyodideRuntime() {
	if (pyodideRuntimePromise) return pyodideRuntimePromise;

	pyodideRuntimePromise = (async () => {
		const baseUrl = import.meta.env.BASE_URL;
		const pyodide = await loadPyodide({
			indexURL: `${baseUrl}pyodide/`,
		});

		await pyodide.loadPackage(`${baseUrl}pyodide-packages/${SQLITE3_WHEEL_FILE}`);

		const parserResponse = await fetch(`${baseUrl}parse_save.py`, {
			cache: 'no-store',
		});
		if (!parserResponse.ok) {
			throw new Error(`Failed to load parse_save.py: ${parserResponse.status}`);
		}

		const parserSource = await parserResponse.text();
		await pyodide.runPythonAsync(parserSource);
		await pyodide.runPythonAsync(`
def parse_save_bridge(data):
    if hasattr(data, "to_py"):
        source = data.to_py()
    else:
        source = data
    return parse_save(bytes(source))
`);

		return pyodide;
	})();

	return pyodideRuntimePromise;
}

export async function extractSaveFile(file) {
	if (!(file instanceof File)) {
		throw new TypeError('extractSaveFile expected a File instance.');
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const pyodide = await initializePyodideRuntime();

	pyodide.globals.set('upload_bytes', bytes);
	try {
		const jsonText = await pyodide.runPythonAsync('parse_save_bridge(upload_bytes)');
		return JSON.parse(jsonText);
	} finally {
		pyodide.globals.delete('upload_bytes');
	}
}
