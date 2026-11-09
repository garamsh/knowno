import type { SqlJsStatic } from "sql.js";

/**
 * The SQLite reader a package's collection is opened with: sql.js's WebAssembly build, its module
 * fetched from the file the bundler serves, which only the import route loads (ADR 0223).
 */
export async function loadSqlite(): Promise<SqlJsStatic> {
  const { default: initSqlJs } = await import("sql.js");
  const wasm = new URL("../../../node_modules/sql.js/dist/sql-wasm-browser.wasm", import.meta.url);
  const response = await fetch(wasm);
  if (!response.ok) throw new Error(`sqlite module: ${String(response.status)}`);
  return initSqlJs({ wasmBinary: await response.arrayBuffer() });
}
