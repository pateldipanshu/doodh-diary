# Doodh Diary: family milk record app (MERN)

React-free MERN app: Express + MongoDB (Atlas) backend, web app in `public/`,
Android wrapper in `mobile/`. One family = one shared diary. Anyone in the
family can add and see slips, expenses and the monthly paid amount.

## 1. Secure your database first
Your Atlas password was shared in a chat, so treat it as exposed.
- Atlas > Database Access: edit the user and set a NEW password, or create a
  new user with "Read and write to any database" instead of Atlas Admin.
- Atlas > Network Access: add 0.0.0.0/0 (allow from anywhere) so the hosted
  server can connect. Protection then comes from the strong password.
- Never put the connection string in code or on GitHub.

## 2. Run on your PC
    cp .env.example .env      # then edit .env: paste your NEW connection string, set JWT_SECRET
    npm install
    npm start                 # open http://localhost:3000

## 3. Put it online (Render, free tier)
1. Upload this folder to a GitHub repository (the .env file is ignored).
2. render.com > New > Web Service > pick the repo.
   Build command: npm install     Start command: npm start
3. Environment variables on Render: MONGODB_URI and JWT_SECRET (long random text).
4. Open the Render URL. Free services sleep when unused, so the first load can
   take up to a minute.

## 4. Family use
- First person: Create account > "Start a new family diary". The app shows a
  6-letter family code under "Your family".
- Everyone else: Create account > "Join my family with a code".
- Records show who added them. Old offline backups can be pasted into
  "Backup and share" > Restore to import them.

## 5. Android APK
1. In your GitHub repo: Settings > Secrets and variables > Actions > Variables,
   add SERVER_URL = your Render address (https://something.onrender.com).
2. Actions > Build APK > Run workflow (about 5 minutes).
3. Download artifact "doodh-diary-apk", install app-debug.apk on the phone.
The app opens your hosted site, so it needs internet.
