# Railway deployment

1. Push this folder to GitHub.
2. In Railway, create a project and deploy the GitHub repository.
3. Railway should detect Node.js automatically.
4. Start command: `npm start` (already configured in package.json).
5. Add these Railway Variables:
   - `ADMIN_PASSWORD` = password for the admin/token setup
   - `SESSION_SECRET` = long random secret for Express sessions
   - `GOPAY_PORT` = internal port untuk app ini (default 13016)
6. Deploy, then use Railway Networking → Generate Domain.

The app binds `127.0.0.1` on `GOPAY_PORT` (default 13016). It deliberately
does NOT read the generic `PORT` variable — Railway injects `PORT=8080` for
the main app, and reading it here would make both apps collide. Public access
is served by nginx on port 3016, proxying to `127.0.0.1:13016` (a wildcard
`0.0.0.0:3016` bind cannot coexist with a `127.0.0.1:3016` bind — EADDRINUSE).
