import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const RESULTS_DIR = path.join(ROOT, "results");
const DEBUG_DIR = path.join(ROOT, "debug");
const DEFAULT_CONFIG = {
  LOGIN_URL: "https://www.78win77.plus/login",
  HEADLESS: "true",
  POLL_MS: "5000",
  USER_DATA_DIR: ".browser-profile"
};
let latestSnapshot = {
  updatedAt: null,
  tables: [],
  status: "starting",
  error: null
};

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

async function loadEnv() {
  try {
    const local = parseEnv(await fs.readFile(ENV_PATH, "utf8"));
    for (const [key, value] of Object.entries(local)) {
      process.env[key] = value;
    }
  } catch {}

  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!process.env[key]) process.env[key] = value;
  }

  if (!process.env.USERNAME || !process.env.PASSWORD) {
    throw new Error("Missing USERNAME or PASSWORD. Set them in Railway Variables.");
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function clickFirst(page, selectors, timeout = 3000) {
  for (const selector of selectors.filter(Boolean)) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout });
      await locator.click({ timeout });
      return selector;
    } catch {}
  }
  return null;
}

async function fillFirst(page, selectors, value, timeout = 3000) {
  for (const selector of selectors.filter(Boolean)) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout });
      await locator.fill(value, { timeout });
      return selector;
    } catch {}
  }
  return null;
}

async function login(page) {
  console.log("Opening login page...");
  await page.goto(required("LOGIN_URL"), { waitUntil: "domcontentloaded" });
  await screenshot(page, "01-login-page");

  if (await isLoggedIn(page)) {
    console.log("Already logged in.");
    return;
  }

  await ensureLoginForm(page);

  const usernameSelector = await fillFirst(page, [
    process.env.USERNAME_SELECTOR,
    "input[name='username']",
    "input[name='account']",
    "input[name='loginName']",
    "input[name*='user' i]",
    "input[name*='account' i]",
    "input[placeholder*='Tài khoản' i]",
    "input[placeholder*='Username' i]",
    "input[placeholder*='Account' i]",
    "input[type='text']"
  ], required("USERNAME"));

  const passwordSelector = await fillFirst(page, [
    process.env.PASSWORD_SELECTOR,
    "input[name='password']",
    "input[name='passwd']",
    "input[name*='pass' i]",
    "input[placeholder*='Mật khẩu' i]",
    "input[placeholder*='Password' i]",
    "input[type='password']"
  ], required("PASSWORD"));

  if (!usernameSelector || !passwordSelector) {
    await ensureLoginForm(page);
  }

  const retryUsernameSelector = usernameSelector || await fillFirst(page, [
    process.env.USERNAME_SELECTOR,
    "input[name='username']",
    "input[name='account']",
    "input[name='loginName']",
    "input[name*='user' i]",
    "input[name*='account' i]",
    "input[placeholder*='Tên Đăng Nhập' i]",
    "input[placeholder*='Tài khoản' i]",
    "input[placeholder*='Username' i]",
    "input[placeholder*='Account' i]",
    "input[type='text']"
  ], required("USERNAME"));

  const retryPasswordSelector = passwordSelector || await fillFirst(page, [
    process.env.PASSWORD_SELECTOR,
    "input[name='password']",
    "input[name='passwd']",
    "input[name*='pass' i]",
    "input[placeholder*='Mật Khẩu' i]",
    "input[placeholder*='Mật khẩu' i]",
    "input[placeholder*='Password' i]",
    "input[type='password']"
  ], required("PASSWORD"));

  if (!retryUsernameSelector || !retryPasswordSelector) {
    await screenshot(page, "02-login-fields-not-found");
    throw new Error("Could not find login fields. Set USERNAME_SELECTOR and PASSWORD_SELECTOR in .env.");
  }

  console.log(`Filled login fields: ${retryUsernameSelector}, ${retryPasswordSelector}`);
  const buttonSelector = await clickFirst(page, [
    process.env.LOGIN_BUTTON_SELECTOR,
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Đăng nhập')",
    "button:has-text('Login')",
    "text=Đăng nhập",
    "text=Login"
  ], 5000);

  if (!buttonSelector) {
    console.log("Login button not detected, pressing Enter...");
    await page.keyboard.press("Enter");
  } else {
    console.log(`Clicked login button: ${buttonSelector}`);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "03-after-login");
}

async function isLoggedIn(page) {
  const username = process.env.USERNAME || "";
  return page.locator(`text=${username}`).first().isVisible({ timeout: 1000 })
    .catch(() => false);
}

async function ensureLoginForm(page) {
  const hasPassword = await page.locator("input[type='password']").first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (hasPassword) return;

  await closePromos(page);
  await clickFirst(page, [
    "button:has-text('Đăng nhập')",
    "a:has-text('Đăng nhập')",
    "text=Đăng nhập",
    "button:has-text('Login')",
    "text=Login"
  ], 3000);
  await page.waitForTimeout(1500);
  await screenshot(page, "01b-login-form-opened");
}

async function enterSexyLobby(page) {
  if (await hasHallApi(page)) return;

  console.log("Finding Sexy/Baccarat lobby...");
  await screenshot(page, "04-before-sexy-click");

  await closePromos(page);
  await clickFirst(page, ["a:has-text('CASINO')", "text=CASINO"], 3000);
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});

  const sexyBanner = page.locator("img[alt='banner-sexybcrt']").first();
  try {
    await sexyBanner.waitFor({ state: "visible", timeout: 8000 });
    const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
    await sexyBanner.click({ timeout: 5000 });
    const popup = await popupPromise;
    const target = popup || page.context().pages().at(-1) || page;
    await target.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await target.waitForTimeout(12000);
    await screenshot(target, "06-after-sexy-banner-click");
    const targetUrl = await target.url();
    const targetTitle = await target.title().catch(() => "");
    if ((await hasHallApi(target)) || /bpcdf|Sexy/i.test(`${targetUrl} ${targetTitle}`)) {
      console.log("Sexy lobby opened and hall API detected.");
      return target;
    }
  } catch {}

  const clicked = await clickFirst(page, [
    process.env.SEXY_SELECTOR,
    `text=${process.env.SEXY_TEXT || "Sexy"}`,
    "text=SEXY",
    "text=Sexy",
    "text=Truyền Thống",
    "text=Baccarat"
  ], 8000);

  if (!clicked) {
    await screenshot(page, "05-sexy-not-found");
    throw new Error("Could not click Sexy lobby. Set SEXY_SELECTOR or SEXY_TEXT in .env.");
  }

  console.log(`Clicked lobby target: ${clicked}`);
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await screenshot(page, "06-after-sexy-click");
  return page;
}

async function closePromos(page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const selector of [
    ".btn-close",
    ".el-dialog__close",
    ".ant-modal-close",
    "button[aria-label='Close']",
    "button:has-text('×')",
    "text=×"
  ]) {
    await clickFirst(page, [selector], 800);
  }

  // The large promo modal on 78win uses an image-like close control without stable text.
  await page.mouse.click(1205, 96).catch(() => {});
  await page.waitForTimeout(800);
}

async function screenshot(page, name) {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(DEBUG_DIR, `${name}.png`),
    fullPage: false
  }).catch(() => {});
}

async function hasHallApi(page) {
  return page.evaluate(() =>
    performance.getEntriesByType("resource").some(x => /queryInitWebGameHall/i.test(x.name))
  ).catch(() => false);
}

async function fetchHallData(page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource")
      .map(x => x.name)
      .find(x => /queryInitWebGameHall/i.test(x));

    const fallback = `${location.origin}/player/query/queryInitWebGameHall`;
    return fetch(url || fallback, { credentials: "include" }).then(r => r.json());
  });
}

function decodeRoad(n) {
  return (n & 4) ? "T" : ((n & 8) ? "P" : "B");
}

function buildBigRoad(results) {
  const cells = [];
  let col = 0;
  let row = 0;
  let last = null;

  for (const result of results) {
    if (result === "T") continue;

    if (!last) {
      col = 0;
      row = 0;
    } else if (result !== last) {
      col += 1;
      row = 0;
    } else {
      const blocked = cells.some(c => c.col === col && c.row === row + 1);
      if (row >= 5 || blocked) col += 1;
      else row += 1;
    }

    cells.push({ result, col, row });
    last = result;
  }

  return cells;
}

function colHeight(cells, col) {
  const rows = cells.filter(c => c.col === col).map(c => c.row);
  return rows.length ? Math.max(...rows) + 1 : 0;
}

function hasCell(cells, col, row) {
  return cells.some(c => c.col === col && c.row === row);
}

function deriveRoad(cells, offset) {
  return cells
    .filter(c => c.col >= offset)
    .map(c => {
      if (c.row === 0) {
        return colHeight(cells, c.col - 1) === colHeight(cells, c.col - 1 - offset) ? "R" : "B";
      }
      return hasCell(cells, c.col - offset, c.row) ? "R" : "B";
    })
    .join("");
}

function extractTables(data) {
  return (data.tableItems || [])
    .filter(item => item.roadInfo?.bigRoads?.length)
    .map(item => {
      const main = item.roadInfo.bigRoads.map(v => decodeRoad(v.road));
      const big = buildBigRoad(main);

      return {
        table: `Baccarat ${item.tableInfo.tableName}`,
        tableID: item.tableInfo.tableID,
        shoe: item.tableInfo.gameShoe,
        round: item.roadInfo.gameRound,
        mainRoad: main.join(""),
        banker: main.filter(v => v === "B").length,
        player: main.filter(v => v === "P").length,
        tie: main.filter(v => v === "T").length,
        bigEyeBoy: deriveRoad(big, 1),
        smallRoad: deriveRoad(big, 2),
        cockroachPig: deriveRoad(big, 3),
        rawRoad: item.roadInfo.bigRoads.map(v => v.road)
      };
    });
}

async function saveSnapshot(tables) {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  latestSnapshot = {
    updatedAt: new Date().toISOString(),
    tables,
    status: "ok",
    error: null
  };

  await fs.writeFile(path.join(RESULTS_DIR, "latest.json"), JSON.stringify(latestSnapshot, null, 2));
  await fs.appendFile(path.join(RESULTS_DIR, "history.jsonl"), JSON.stringify(latestSnapshot) + "\n");
}

function startServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, status: latestSnapshot.status, updatedAt: latestSnapshot.updatedAt }));
      return;
    }

    if (url.pathname === "/latest.json" || url.pathname === "/api/latest") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(latestSnapshot, null, 2));
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderHtml(latestSnapshot));
  });

  server.listen(port, () => {
    console.log(`Status server listening on port ${port}`);
  });

  return server;
}

function renderHtml(snapshot) {
  const rows = snapshot.tables.map(table => `
    <tr>
      <td>${escapeHtml(table.table)}</td>
      <td>${table.round ?? ""}</td>
      <td>${table.banker}</td>
      <td>${table.player}</td>
      <td>${table.tie}</td>
      <td><code>${escapeHtml(table.mainRoad)}</code></td>
      <td><code>${escapeHtml(table.bigEyeBoy)}</code></td>
      <td><code>${escapeHtml(table.smallRoad)}</code></td>
      <td><code>${escapeHtml(table.cockroachPig)}</code></td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>Baccarat Sexy Roads</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #111827; color: #e5e7eb; }
    main { padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { color: #9ca3af; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; background: #1f2937; }
    th, td { border-bottom: 1px solid #374151; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { color: #f9fafb; position: sticky; top: 0; background: #111827; }
    code { word-break: break-all; color: #fde68a; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <main>
    <h1>Baccarat Sexy Roads</h1>
    <div class="meta">Status: ${escapeHtml(snapshot.status)} | Updated: ${escapeHtml(snapshot.updatedAt || "waiting")}</div>
    ${snapshot.error ? `<p class="error">${escapeHtml(snapshot.error)}</p>` : ""}
    <table>
      <thead>
        <tr>
          <th>Table</th><th>Round</th><th>B</th><th>P</th><th>T</th>
          <th>Main</th><th>Big Eye</th><th>Small</th><th>Cockroach</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  const server = startServer();
  console.log("Starting watcher...");
  try {
    await loadEnv();
  } catch (error) {
    latestSnapshot = {
      ...latestSnapshot,
      status: "missing_config",
      error: error.message
    };
    console.error(error.message);
    return;
  }
  console.log("Loaded .env");

  console.log("Launching browser context...");
  const context = await chromium.launchPersistentContext(
    path.resolve(ROOT, process.env.USER_DATA_DIR || ".browser-profile"),
    {
      headless: String(process.env.HEADLESS || "false").toLowerCase() === "true",
      viewport: { width: 1366, height: 768 }
    }
  );

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(10000);

  await login(page);
  let activePage = await enterSexyLobby(page);

  const pollMs = Number(process.env.POLL_MS || 5000);
  console.log(`Watching baccarat roads every ${pollMs}ms...`);

  while (true) {
    try {
      const data = await fetchHallData(activePage);
      if (!data?.tableItems) {
        console.log(`[${new Date().toLocaleTimeString()}] Waiting for hall data...`);
        activePage = await enterSexyLobby(page);
      } else {
        const tables = extractTables(data);
        await saveSnapshot(tables);
        console.clear();
        console.table(tables.map(t => ({
          table: t.table,
          round: t.round,
          mainRoad: t.mainRoad,
          B: t.banker,
          P: t.player,
          T: t.tie,
          bigEyeBoy: t.bigEyeBoy,
          smallRoad: t.smallRoad,
          cockroachPig: t.cockroachPig
        })));
        console.log(`Saved ${tables.length} tables -> results/latest.json`);
      }
    } catch (error) {
      latestSnapshot = {
        ...latestSnapshot,
        status: "error",
        error: error.message
      };
      console.error(`[${new Date().toLocaleTimeString()}] ${error.message}`);
    }

    if (String(process.env.ONCE || "").toLowerCase() === "true") {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  await context.close();
  server.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
