// Headless-Chromium harness — serves this viewer with the *real* security
// headers (incl. CSP) from `_headers` and drives index.html, per the dev
// standards (§15) and DESIGN-SPEC §12/§13. Exit 1 on any failure.
//
// CI note: this runner's Chromium decodes WebM (VP8/VP9) but not the
// proprietary/removed codecs, so real-playback checks use the committed
// test/fixtures/sample.webm; every other fixture is generated here in Node
// (name-based gates need no real bytes).
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 8099;

const H = {};
for (const line of readFileSync(join(ROOT, "_headers"), "utf8").split("\n")) {
  const m = line.match(/^[ \t]+([A-Za-z0-9-]+):[ \t]*(.+?)\s*$/);
  if (m && !line.trim().startsWith("#")) H[m[1]] = m[2];
}
if (!H["Content-Security-Policy"]) {
  console.error("FAIL: no Content-Security-Policy found in _headers");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain",
  ".webm": "video/webm", ".mp4": "video/mp4",
};
const mime = (p) => MIME[p.slice(p.lastIndexOf("."))] || "application/octet-stream";

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let fp = join(ROOT, p);
  if (!fp.startsWith(ROOT) || !existsSync(fp)) fp = join(ROOT, "index.html");
  try {
    res.writeHead(200, { ...H, "Content-Type": mime(fp) });
    res.end(readFileSync(fp));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(PORT, r));

// -- fixtures: the real .webm is committed; the rest are name-based
const FIX = mkdtempSync(join(tmpdir(), "vv-fixtures-"));
const WEBM = join(ROOT, "test", "fixtures", "sample.webm");
writeFileSync(join(FIX, "test.json"), '{"hello":"data"}');
writeFileSync(join(FIX, "sample.xyz"), "not ours");
writeFileSync(join(FIX, "fake.avi"), "RIFF....AVI LIST....not a real avi");

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail]);
const errs = [];
const hook = (page) => {
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
};

// -- main context: light system scheme, full toggle round-trip
const ctx = await browser.newContext({
  colorScheme: "light",
  viewport: { width: 1240, height: 800 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
hook(page);
// instrument object-URL revocation before any page script runs
await page.addInitScript(() => {
  window.__revoked = [];
  const orig = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (u) => { window.__revoked.push(String(u)); return orig(u); };
});
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
check("font loads under CSP", await page.evaluate(() => [...document.fonts].some((f) => f.family.includes("JetBrains"))));
check("heading uses JetBrains Mono", await page.evaluate(() => {
  const el = document.querySelector(".doc-title") || document.querySelector(".empty-title");
  return el && getComputedStyle(el).fontFamily.includes("JetBrains Mono");
}));
check("light default with light system scheme", await page.evaluate(() => document.getElementById("bgPicker").value) === "#ffffff");
check("toggle present in toolbar", await page.evaluate(() => {
  const t = document.getElementById("themeToggle");
  return !!t && t.hasAttribute("aria-pressed") && !!t.closest("nav.actions");
}));
await page.click("#themeToggle");
check("toggle to dark sets picker #0d1117", await page.evaluate(() => document.getElementById("bgPicker").value) === "#0d1117");
check("choice persists (mykk-bg)", await page.evaluate(() => { try { return localStorage.getItem("mykk-bg") === "#0d1117"; } catch (e) { return false; } }));
await page.click("#themeToggle");
check("toggle back to light", await page.evaluate(() => document.getElementById("bgPicker").value) === "#ffffff");

// -- real playback: the committed WebM must actually decode (CI Chromium has VP8/VP9)
await page.setInputFiles("#fileInput", WEBM);
await page.waitForFunction(() => {
  const v = document.getElementById("player");
  return v && v.readyState >= 1 && v.videoWidth > 0;
}, null, { timeout: 15000 });
check("webm plays: loadedmetadata + intrinsic size + duration", await page.evaluate(() => {
  const v = document.getElementById("player");
  return v.videoWidth > 0 && v.videoHeight > 0 && v.duration > 0;
}));
check("viewing state + title + stage visible", await page.evaluate(() =>
  document.body.classList.contains("viewing") &&
  !document.getElementById("stage").hidden &&
  document.getElementById("docTitle").textContent === "sample.webm" &&
  document.title.startsWith("sample.webm")
));
check("metadata line filled", await page.evaluate(() =>
  /^\d+×\d+ · \d+:\d\d · .+ · .+/.test(document.getElementById("metaLine").textContent)
));

// keyboard: Space toggles paused; ArrowRight advances currentTime
await page.evaluate(() => {
  const v = document.getElementById("player");
  v.muted = true; v.pause(); v.currentTime = 0;
  document.body.focus();
});
await page.keyboard.press(" ");
await page.waitForFunction(() => !document.getElementById("player").paused, null, { timeout: 5000 });
check("Space plays (paused → playing)", true);
await page.keyboard.press(" ");
check("Space pauses again", await page.evaluate(() => document.getElementById("player").paused));
await page.evaluate(() => { document.getElementById("player").currentTime = 0; });
await page.keyboard.press("ArrowRight");
check("ArrowRight advances currentTime", await page.evaluate(() => document.getElementById("player").currentTime > 0));

// grab-frame: click the camera button, catch the download, verify PNG magic + intrinsic dims
const dlPromise = page.waitForEvent("download", { timeout: 10000 });
await page.click("#btnFrame");
const dl = await dlPromise;
const dlPath = await dl.path();
const png = readFileSync(dlPath);
const pngMagic = png.length > 24 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
const pngW = png.readUInt32BE(16), pngH = png.readUInt32BE(20);
const [vw, vh] = await page.evaluate(() => {
  const v = document.getElementById("player");
  return [v.videoWidth, v.videoHeight];
});
check("grab-frame downloads a real PNG", pngMagic, dl.suggestedFilename());
check("frame PNG has the video's intrinsic dimensions", pngW === vw && pngH === vh, `${pngW}×${pngH} vs ${vw}×${vh}`);
check("frame filename is <basename>-<m>m<s>s.png", /^sample-\d+m\d+s\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());

// drop-to-replace revokes the previous object URL; Clear revokes the current one
const url1 = await page.evaluate(() => document.getElementById("player").currentSrc);
await page.setInputFiles("#fileInput", WEBM);
await page.waitForFunction((u) => window.__revoked.includes(u), url1, { timeout: 5000 });
check("replace revokes the previous object URL", true);
const url2 = await page.evaluate(() => document.getElementById("player").currentSrc);
await page.click("#btnClear");
check("Clear revokes the object URL and resets the shell", await page.evaluate((u) =>
  window.__revoked.includes(u) &&
  !document.getElementById("empty").hidden &&
  document.getElementById("stage").hidden &&
  !document.body.classList.contains("viewing"), url2));

// -- accept-with-notice: .avi shows the honest no-decoder card, never a silent drop
await page.setInputFiles("#fileInput", join(FIX, "fake.avi"));
check(".avi shows the accept-with-notice card", await page.evaluate(() =>
  !document.getElementById("notice").hidden &&
  document.getElementById("noticeTitle").textContent.includes(".avi") &&
  document.getElementById("noticeNote").textContent === "Your file was not uploaded anywhere."
));
await page.click("#btnClear");

// -- family router: a sibling's type gets the offer card, not the toast
await page.setInputFiles("#fileInput", join(FIX, "test.json"));
await page.waitForSelector("#routeCard:not([hidden])", { timeout: 5000 });
check("route card offers Data Viewer for .json", await page.evaluate(() =>
  document.getElementById("routeMsg").textContent.includes("belongs to Data Viewer")
));
check("route card focuses #routeGo", await page.evaluate(() => document.activeElement === document.getElementById("routeGo")));
await page.keyboard.press("Tab");
const tab1 = await page.evaluate(() => document.activeElement.id);
await page.keyboard.press("Tab");
const tab2 = await page.evaluate(() => document.activeElement.id);
check("Tab wraps between the two buttons", tab1 === "routeDismiss" && tab2 === "routeGo", `${tab1} → ${tab2}`);
await page.keyboard.press("Escape");
check("Escape dismisses the route card", await page.evaluate(() => document.getElementById("routeCard").hidden));
await page.setInputFiles("#fileInput", join(FIX, "test.json"));
await page.waitForSelector("#routeCard:not([hidden])", { timeout: 5000 });
await page.click("#routeDismiss");
check("Not now dismisses the route card", await page.evaluate(() => document.getElementById("routeCard").hidden));

// -- unmapped extension keeps the plain rejection toast
await page.setInputFiles("#fileInput", join(FIX, "sample.xyz"));
await page.waitForSelector(".toast.show", { timeout: 5000 });
check("unmapped type gets the rejection toast", await page.evaluate(() =>
  document.getElementById("toast").textContent === "“sample.xyz” isn’t a supported video file" &&
  document.getElementById("routeCard").hidden
));
await ctx.close();

// -- fresh context with dark system scheme: must default dark
const ctx2 = await browser.newContext({ colorScheme: "dark" });
const p2 = await ctx2.newPage();
hook(p2);
await p2.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });
check("system-dark default (#0d1117)", await p2.evaluate(() => document.getElementById("bgPicker").value) === "#0d1117");

// -- receiver hardening: a malformed #fvh must boot clean and clear the hash
const p3 = await ctx2.newPage();
hook(p3);
await p3.goto(`http://localhost:${PORT}/#fvh=%zz`, { waitUntil: "load", timeout: 30000 });
check("#fvh=%zz boots clean and clears the hash", await p3.evaluate(() =>
  location.hash === "" && !document.getElementById("empty").hidden
));
await ctx2.close();

// -- FV-MAP governance: the block between the markers deep-equals the canonical map
const idx = readFileSync(join(ROOT, "index.html"), "utf8");
const mStart = idx.indexOf("/* FV-MAP-START");
const mEnd = idx.indexOf("/* FV-MAP-END */");
let mapOk = false, mapDetail = "";
try {
  const block = idx.slice(idx.indexOf("*/", mStart) + 2, mEnd);
  const got = new Function(block + "; return { FAMILY, FAMILY_HUB, FAMILY_NAMES, FAMILY_MAP };")();
  const want = JSON.parse(readFileSync(join(ROOT, "test", "family-map.json"), "utf8"));
  const deepEq = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
  const sort = (o) => (o && typeof o === "object" && !Array.isArray(o))
    ? Object.keys(o).sort().reduce((r, k) => (r[k] = sort(o[k]), r), {}) : o;
  mapOk = mStart !== -1 && mEnd !== -1 &&
    deepEq(got.FAMILY, want.family) && got.FAMILY_HUB === want.hub &&
    deepEq(got.FAMILY_NAMES, want.names) && deepEq(got.FAMILY_MAP, want.map);
  if (!mapOk) mapDetail = "FV-MAP block ≠ family-map.json";
} catch (e) { mapDetail = String(e); }
check("FV-MAP block deep-equals canonical family-map.json", mapOk, mapDetail);

// -- static assertions
const sz = (p) => (existsSync(join(ROOT, p)) ? statSync(join(ROOT, p)).size : 0);
check("fonts present", sz("fonts/JetBrainsMono-Bold.subset.woff2") > 10000 && sz("fonts/JetBrainsMono-ExtraBold.subset.woff2") > 10000 && sz("fonts/OFL.txt") > 0);
check("favicon.ico present", sz("favicon.ico") > 2000);
check("og.png + apple-touch-icon.png present", sz("og.png") > 10000 && sz("apple-touch-icon.png") > 500);
check("site.webmanifest valid", (() => { try { return !!JSON.parse(readFileSync(join(ROOT, "site.webmanifest"), "utf8")).name; } catch (e) { return false; } })());
check("llms/ads/security.txt present", sz("llms.txt") > 0 && sz("ads.txt") > 0 && sz(".well-known/security.txt") > 0);
const csp = H["Content-Security-Policy"];
check("CSP: default-src 'none' + media-src 'self' blob:", /default-src 'none'/.test(csp) && /media-src 'self' blob:/.test(csp));
check("CSP allows self fonts + manifest", /font-src[^;]*'self'/.test(csp) && /manifest-src 'self'/.test(csp));
check("head links (manifest + favicon.ico)", idx.includes('rel="manifest"') && idx.includes("/favicon.ico"));
check("no eval / new Function in the page", !/\beval\s*\(/.test(idx) && !/new Function/.test(idx));

// External-resource network noise (analytics offline) is allowed; CSP
// violations are worded "Refused to ..." and still fail.
const ALLOW = [/plausible/i, /thompsonblack/i, /net::ERR/i, /Failed to load resource/i];
const real = errs.filter((e) => !ALLOW.some((re) => re.test(e)));
check("no unexpected console/CSP errors", real.length === 0, real[0]);

await browser.close();
server.close();

let failed = 0;
for (const [name, ok, detail] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  — " + String(detail).slice(0, 160) : ""}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
