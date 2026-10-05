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

## Run locally

Requires Node.js 18+.

```bash
npm install
ADMIN_PASSWORD=choose-a-strong-password npm start
```

Open http://localhost:3000/admin, sign in, create a form, add a **File upload**
question, save, and use **Copy link** to share it.

## Configuration

| Variable          | Purpose                                                                    |
|-------------------|----------------------------------------------------------------------------|
| `ADMIN_PASSWORD`  | Password for the admin area. If unset, a random one is printed at startup. |
| `SESSION_SECRET`  | Signs login cookies. Set it so logins survive restarts.                    |
| `PORT`            | HTTP port (default `3000`).                                                |
| `DATA_DIR`        | Where `db.json` and `uploads/` are stored (default `./data`).              |
| `PUBLIC_URL`      | Base URL used in share links, e.g. `https://forms.example.com`.            |
| `TRUST_PROXY`     | Set to `1` when running behind a reverse proxy / load balancer (HTTPS).    |

## Deploy

Any host that runs Node or Docker and gives you a **persistent disk** works
(Render, Railway, Fly.io, a VPS). Mount the disk at `DATA_DIR`, otherwise
uploads are lost on redeploy.

```bash
docker build -t adetelz-forms .
docker run -p 3000:3000 -v forms-data:/app/data \
  -e ADMIN_PASSWORD=... -e SESSION_SECRET=... adetelz-forms
```

Always serve it over HTTPS in production, and back up `DATA_DIR`.

## Tests

```bash
npm test
```

## Possible next steps

- Email notification to the admin on each new response
- Store uploads in S3 / Azure Blob / OneDrive instead of local disk
- Multiple admin users
- Virus scanning of uploads (e.g. ClamAV)
