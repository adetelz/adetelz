# Adetelz Forms

A small, self-hosted form builder (like Microsoft Forms / Google Forms) where
**anyone with the link can submit a response and attach files**. Respondents
do not need an account.

Microsoft Forms only allows file-upload questions when respondents sign in
to your organisation. This app has no such restriction: external clients,
vendors and applicants can upload documents directly.

## Features

- Form builder: short answer, paragraph, email, number, date, dropdown,
  multiple choice, checkboxes and **file upload** questions
- Per-question upload rules: allowed file types (e.g. `.pdf,.docx`), max size
  (up to 100 MB) and max number of files (up to 20)
- Public share link (`/f/<id>`) with drag-and-drop uploads and an upload progress bar
- Admin area with password login: see responses, download single files,
  **download all files as a ZIP**, export responses to CSV
- Open or close a form for responses, delete individual responses
- Uploaded files are stored with random names and can only be downloaded by the admin

## Put it online for free (Render + Supabase)

This takes about 15 minutes and uses only the free plans of both services.
**Supabase** stores the responses and uploaded files (free: 1 GB, files up to
50 MB). **Render** runs the website (free plan).

### 1. Create the storage (Supabase)

1. Go to https://supabase.com, click **Start your project** and sign up (you can use GitHub).
2. Click **New project**. Choose any name (e.g. `adetelz-forms`), make up a
   database password (you won't need it here) and pick the region closest to you.
   Wait a minute or two for it to be ready.
3. Open **Project Settings → Data API** (or **API**) and copy the **Project URL**,
   e.g. `https://abcdefgh.supabase.co`.
4. Open **Project Settings → API Keys** and copy the **secret** key (starts with
   `sb_secret_`). On older projects this is the `service_role` key.
   Keep it private: anyone with it can read your files.

You don't need to create any tables or buckets: the app creates a private
`forms` bucket by itself the first time it starts.

### 2. Run the website (Render)

1. Go to https://dashboard.render.com and sign up with GitHub.
2. Click **New + → Blueprint**, connect GitHub and pick this repository
   (and the branch the code is on).
3. Render asks for three values:
   - `ADMIN_PASSWORD`: the password you'll use to manage your forms
   - `SUPABASE_URL`: the Project URL from step 1.3
   - `SUPABASE_SECRET_KEY`: the secret key from step 1.4
4. Click **Apply** and wait for the build to finish (a few minutes).
5. Render shows your address, e.g. `https://adetelz-forms-xxxx.onrender.com`.
   Open it with `/admin` on the end, sign in, and create your first form.

### Things to know about the free plans

- **Render** puts the site to sleep after 15 minutes with no visitors. The next
  visitor waits about a minute while it wakes up; after that it's fast.
- **Supabase** pauses a free project after about a week with no activity. Your
  data is kept; sign in to Supabase and click **Restore project** to wake it.
- Run only **one** copy of the website at a time: it keeps the response list in
  memory and saves it as a single file in Supabase.
- Download your responses (CSV and ZIP) every now and then as a backup.

## Run on your own computer

Requires Node.js 18+.

```bash
npm install
ADMIN_PASSWORD=choose-a-strong-password npm start
```

Open http://localhost:3000/admin. Without the Supabase settings, responses
and files are saved in the `data/` folder.

## Configuration

| Variable              | Purpose                                                                    |
|-----------------------|----------------------------------------------------------------------------|
| `ADMIN_PASSWORD`      | Password for the admin area. If unset, a random one is printed at startup. |
| `SUPABASE_URL`        | Supabase Project URL. With the key below, storage goes to Supabase.        |
| `SUPABASE_SECRET_KEY` | Supabase secret (or legacy `service_role`) key. Server-side only.          |
| `SUPABASE_BUCKET`     | Storage bucket name (default `forms`, created automatically).              |
| `MAX_UPLOAD_MB`       | Largest file size a form may allow (default 100; use 50 on Supabase free). |
| `SESSION_SECRET`      | Signs login cookies. Set it so logins survive restarts.                    |
| `PORT`                | HTTP port (default `3000`).                                                |
| `DATA_DIR`            | Local storage folder when Supabase isn't configured (default `./data`).    |
| `PUBLIC_URL`          | Base URL used in share links, e.g. `https://forms.example.com`.            |
| `TRUST_PROXY`         | Set to `1` when running behind a reverse proxy / load balancer (HTTPS).    |

## Other ways to host

Any host that runs Node or Docker works. With Supabase configured, no disk is
needed. Without it, give the app a persistent disk mounted at `DATA_DIR`.

```bash
docker build -t adetelz-forms .
docker run -p 3000:3000 -e ADMIN_PASSWORD=... -e SUPABASE_URL=... -e SUPABASE_SECRET_KEY=... adetelz-forms
```

## Tests

```bash
npm test
```

## Possible next steps

- Email notification to the admin on each new response
- Multiple admin users
- Virus scanning of uploads (e.g. ClamAV)
