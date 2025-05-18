/**
 * Bun Package Installer & Downloader (Link-based)
 * -------------------------------------------------
 * Adds a branded footer: “Made by Lunary” with the Lunary logo linking
 * to https://lunary.ai.
 */

import { serve } from "bun";

// -------------------------------------------------------------------------
// Config
// -------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3000);
const TTL_MS = 60 * 60 * 1000; // 1 hour
const SIZE_LIMIT = 1_000_000;  // 1 MB

// -------------------------------------------------------------------------
// In‑memory store of temporary archives
// -------------------------------------------------------------------------
const store = new Map<string, { path: string; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, { path, expires }] of store) {
    if (expires < now) {
      Bun.spawnSync(["rm", "-rf", path]);
      store.delete(id);
    }
  }
}, 30 * 60 * 1000);

// -------------------------------------------------------------------------
// HTML helpers
// -------------------------------------------------------------------------
const base = (inner: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bun node_modules builder</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;min-height:100vh;background:#f9fafb}
    form,main{background:#fff;padding:2rem;border-radius:1rem;box-shadow:0 8px 24px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:1rem;width:clamp(320px,90vw,560px)}
    h2{margin:0;font-size:1.25rem;text-align:center}
    label{font-weight:600}
    textarea{min-height:160px;font-family:monospace;padding:.5rem;border:1px solid #e5e7eb;border-radius:.5rem}
    input[type=file],input.copy{padding:.5rem;border:1px solid #e5e7eb;border-radius:.5rem;font-family:monospace}
    button{padding:.75rem 1.5rem;border:none;border-radius:.5rem;font-size:1rem;cursor:pointer;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;gap:.5rem}
    button:disabled{opacity:.6;cursor:not-allowed}
    .spinner{border:2px solid transparent;border-top:2px solid #fff;border-radius:50%;width:16px;height:16px;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    code{background:#f3f4f6;padding:.25rem .5rem;border-radius:.25rem;font-size:.875rem}
    footer.lunary{margin-top:2rem;font-size:.875rem;color:#6b7280;text-align:center}
    footer.lunary a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:.25rem}
    footer.lunary img{height:20px;filter:grayscale(1);}
  </style>
</head>
<body>
  ${inner}
  <footer class="lunary">
    <a href="https://lunary.ai" target="_blank" rel="noopener noreferrer">
      <img src="https://lunary.ai/icon-dark.svg" alt="Lunary logo" />
      Made&nbsp;by&nbsp;Lunary
    </a>
  </footer>
</body>
</html>`;

const formPage = () => base(`<form method="POST" enctype="multipart/form-data" action="/upload">
  <h2>Build & share node_modules</h2>
  <label>Upload package.json</label>
  <input type="file" name="packageFile" accept=".json" />
  <label>Or paste package.json contents</label>
  <textarea name="packageText" placeholder="{\n  \"name\": \"my-app\",\n  ...\n}"></textarea>
  <button id="buildBtn" type="submit"><span class="btn-label">Install & Generate Link</span></button>
  <script>
    const btn=document.getElementById('buildBtn');
    document.querySelector('form').addEventListener('submit',()=>{
      btn.disabled=true;
      btn.innerHTML='<span class="spinner"></span> Building...';
    });
  </script>
</form>`);

const successPage = (link: string) => base(`<main>
  <h2>Your archive is ready!</h2>
  <p>Download with:</p>
  <p><code>curl -OJ ${link}</code></p>
  <input class="copy" value="${link}" readonly onclick="this.select()" />
  <p style="font-size:.875rem;color:#6b7280">Saves as <code>node_modules.tar.gz</code>; link expires in 1&nbsp;hour.</p>
  <a href="/">⇠ Build another</a>
</main>`);

// -------------------------------------------------------------------------
// Server
// -------------------------------------------------------------------------
const server = serve({ port: PORT, async fetch(req) {
  const { pathname, origin } = new URL(req.url);

  if (req.method === "GET" && pathname === "/") {
    return new Response(formPage(), { headers: { "Content-Type": "text/html;charset=utf-8" } });
  }

  if (req.method === "POST" && pathname === "/upload") {
    try {
      const fd = await req.formData();
      let pkg: string;

      const pasted = fd.get("packageText");
      if (typeof pasted === "string" && pasted.trim()) {
        pkg = pasted.trim();
        if (pkg.length > SIZE_LIMIT) return new Response("JSON too large (1 MB limit).", { status: 413 });
      } else {
        const file = fd.get("packageFile");
        if (!(file instanceof File)) return new Response("No package.json provided.", { status: 400 });
        if (file.size > SIZE_LIMIT) return new Response("File too large (1 MB limit).", { status: 413 });
        pkg = new TextDecoder().decode(await file.arrayBuffer());
      }

      try { JSON.parse(pkg); } catch { return new Response("Invalid JSON.", { status: 400 }); }

      const tmp = (await Bun.$`mktemp -d`.text()).trim();
      await Bun.write(`${tmp}/package.json`, pkg);

      const install = Bun.spawnSync(["bun", "install", "--no-save", "--no-progress"], { cwd: tmp, stdout: "pipe", stderr: "pipe" });
      if (install.exitCode !== 0) {
        const err = new TextDecoder().decode(install.stderr);
        return new Response(`bun install failed:\n${err}`, { status: 500 });
      }

      const archivePath = `${tmp}/node_modules.tar.gz`;
      const tar = Bun.spawnSync(["tar", "-czf", archivePath, "node_modules"], { cwd: tmp });
      if (tar.exitCode !== 0) {
        const err = new TextDecoder().decode(tar.stderr);
        return new Response(`Archive failed:\n${err}`, { status: 500 });
      }

      const id = crypto.randomUUID();
      store.set(id, { path: archivePath, expires: Date.now() + TTL_MS });
      return new Response(successPage(`${origin}/download/${id}`), { headers: { "Content-Type": "text/html;charset=utf-8" } });
    } catch (err) {
      console.error(err);
      return new Response("Internal server error", { status: 500 });
    }
  }

  if (req.method === "GET" && pathname.startsWith("/download/")) {
    const id = pathname.slice("/download/".length);
    const entry = store.get(id);
    if (!entry) return new Response("Not found or expired", { status: 404 });
    if (entry.expires < Date.now()) { store.delete(id); return new Response("Expired", { status: 410 }); }

    const file = Bun.file(entry.path);
    const { size } = await file.stat();
    return new Response(file.stream(), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": size.toString(),
        "Content-Disposition": 'attachment; filename="node_modules.tar.gz"',
      },
    });
  }

  return new Response("Not Found", { status: 404 });
}});

console.log(`Server running at http://localhost:${PORT}`);
