# Baccarat Sexy Road Watcher

Node worker that logs in, opens the Sexy Baccarat lobby, reads the hall road API, and exposes the latest roads over HTTP.

## Local Run

```powershell
copy .env.example .env
npm install
npx playwright install chromium
npm start
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/latest.json`
- `http://localhost:3000/health`

## Railway

Use Railway, not Netlify, because this app needs a long-running Node process with Chromium/Playwright.

Set these Railway variables:

```env
USERNAME=your_username
PASSWORD=your_password
```

These are already defaulted in code, so you do not need to set them unless the site changes:

```env
LOGIN_URL=https://www.78win77.plus/login
HEADLESS=true
POLL_MS=5000
USER_DATA_DIR=.browser-profile
```

Do not commit `.env`; it is ignored by git. Never push `PASSWORD` to GitHub.
