import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Hash = require("ipfs-only-hash");
const dist = path.resolve("frontend/dist"), store = path.resolve("store");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/pin") {
    const chunks = []; for await (const ch of req) chunks.push(ch);
    const buf = Buffer.concat(chunks);
    const cid = await Hash.of(buf);
    fs.writeFileSync(path.join(store, cid), buf);
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ cid, size: buf.length }));
  }
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(5173, () => console.log("Frontend on http://localhost:5173"));
