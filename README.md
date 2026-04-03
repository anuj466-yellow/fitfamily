# FitFamily 🏆

Family fitness competition app with AI-powered nutrition tracking.

---

## Quick Start (do this once)

### 1. Set up the database
- Go to supabase.com → your project → SQL Editor → New Query
- Copy everything from `schema.sql` and paste it → click Run
- You should see: "Database ready!"

### 2. Install and run
Open Terminal, go to this folder:

```bash
cd ~/Desktop/fitfamily
npm install
npm start
```

App opens at http://localhost:3000

### 3. Login
- Admin: `admin` / `Monarc@met1920`
- Create family member accounts from the Admin panel

---

## Deploy online (Vercel — free)

```bash
# Install GitHub CLI
brew install gh

# Login
gh auth login

# Push to GitHub
git init
git add .
git commit -m "initial commit"
gh repo create fitfamily --public --push --source=.
```

Then:
1. Go to vercel.com → Sign up with GitHub
2. Import your `fitfamily` repo
3. Add Environment Variables:
   - `REACT_APP_SUPABASE_URL` = your Supabase URL
   - `REACT_APP_SUPABASE_KEY` = your Supabase key
4. Click Deploy → get your shareable link

---

## Project structure

```
fitfamily/
  src/
    App.js        ← entire app (all components)
    supabase.js   ← database connection
    index.js      ← React entry point
  public/
    index.html    ← HTML shell
  .env            ← your Supabase credentials
  schema.sql      ← run this in Supabase once
  package.json    ← dependencies
```
