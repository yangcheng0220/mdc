/** Exercise the real Windows URL handler on a disposable CI runner. A request
 * to our loopback server proves the URL reached a browser with its query intact. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "tsup";

assert.equal(process.platform, "win32", "run this smoke check on Windows");
await build({
  config: false, entry: ["src/launch.ts"], outDir: ".launch-smoke",
  format: ["esm"], target: "node24", noExternal: ["smol-toml"], dts: false, clean: true,
});
// The smoke module is generated on the runner, not checked into the repository.
const launcherModule = new URL("../.launch-smoke/launch.js", import.meta.url);
const { openWorkspaceWindow } = await import(launcherModule.href);
let receive;
const received = new Promise((resolve) => { receive = resolve; });
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><title>mdc launcher check</title>Launcher ready");
  if (request.url?.startsWith("/launcher-smoke?")) receive(request.url);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
let deadline;
try {
  const timeout = new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error("Windows URL handler did not reach the loopback server")), 30_000);
  });
  const [request] = await Promise.all([
    Promise.race([received, timeout]),
    openWorkspaceWindow(`${base}/launcher-smoke?first=one&second=two`, false),
  ]);
  const url = new URL(request, base);
  assert.equal(url.searchParams.get("first"), "one");
  assert.equal(url.searchParams.get("second"), "two");
  console.log("Real Windows browser handler reached loopback with both URL arguments intact.");
} finally {
  clearTimeout(deadline);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
