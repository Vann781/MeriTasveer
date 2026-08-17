# MeriTasveer

Find your photos from an event by taking three selfies.

Clubs and colleges usually dump event photos into a Google Drive folder and share the link. Nobody
scrolls through 400 pictures to find the six they are in. MeriTasveer sits in front of that folder:
a participant signs in, picks the event they attended, takes three selfies with their camera, and
gets back only the photos containing their face.

The photos never move. Google Drive stays the source of truth, the folder stays private, and no
Drive link is ever handed to a participant.

---

## How it works

```
Google Drive folder                 One subfolder per event
        │
        ▼
Indexing (once per event)           Download each photo, detect faces,
        │                           store 512-d embeddings in SQLite,
        ▼                           discard the image
   SQLite database                  Metadata and embeddings only — never photos
        │
        ▼
Participant search                  Three selfies → three embeddings →
        │                           compared against that event only
        ▼
Matched photos                      Streamed from Drive through the backend
```

Two things are worth knowing about the design:

**Photos are indexed once, not searched live.** Running face detection over 500 photos on every
search would be slow and would burn Drive API quota. Instead an organizer indexes an event once,
and searches then compare embeddings, which takes milliseconds.

**Selfies are never stored.** They exist in memory while the search runs and are dropped afterwards.
They are not written to disk, not saved to the database, and not uploaded to Drive. Only the
embeddings of *event* photos are kept, because that is what makes searching possible at all.

---

## Stack

| Part | Choice | Why |
|---|---|---|
| Backend | Node 22, Express 5 | Express 5 forwards async errors natively |
| Database | SQLite (`better-sqlite3`) | All SQL sits in one file, so Postgres is a contained swap |
| Face detection | SCRFD (InsightFace) via `onnxruntime-node` | Finds small faces in group shots |
| Face embeddings | ArcFace r50, 512-d | Best real-world accuracy of the options tested |
| Images | `sharp`, `heic-convert` | iPhone HEIC has to be converted before anything can read it |
| Frontend | React 19, Vite, Tailwind v4 | — |

TensorFlow.js was the obvious first choice and was rejected: `@tensorflow/tfjs-node` has no prebuilt
binary for Node 22 on Windows and tries to compile libtensorflow from source. ONNX Runtime ships
working prebuilts everywhere.

---

## Running it locally

Requires Node 22+ and a Google account.

```bash
git clone https://github.com/Vann781/MeriTasveer.git
cd MeriTasveer
npm run install:all

cp backend/.env.example backend/.env   # then fill it in, see below
npm run models:download                # ~190 MB, once

npm run dev:backend                    # http://localhost:5000
npm run dev:frontend                   # http://localhost:5173
```

### 1. Give the backend access to your Drive folder

Create a **service account** in the [Google Cloud console](https://console.cloud.google.com):

1. Select or create a project, then **APIs & Services → Library → Google Drive API → Enable**.
2. **IAM & Admin → Service Accounts → Create**. No roles needed.
3. Open it, **Keys → Add key → JSON**, and save the file to `backend/credentials/`.
4. In Google Drive, share the folder that holds your event subfolders with the service account's
   `...@....iam.gserviceaccount.com` address as **Viewer**.

Then set in `backend/.env`:

```env
GOOGLE_DRIVE_ROOT_FOLDER_ID=      # from the folder URL
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./credentials/your-key.json
```

Check it works:

```bash
npm run test:drive
```

### 2. Let participants sign in

**Credentials → Create credentials → OAuth client ID → Web application**:

- Authorized JavaScript origin: `http://localhost:5173`
- Authorized redirect URI: `http://localhost:5000/api/auth/google/callback`

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=          # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_EMAILS=you@example.com
```

`ADMIN_EMAILS` is the whole permission model: those addresses get the admin dashboard, everyone else
is a participant.

### 3. Index an event

From the admin dashboard, or from the command line:

```bash
npm run index -- --list                 # every event and its status
npm run index -- "Robotics Workshop"    # index one
npm run index -- --all                  # everything
```

Expect roughly 2–5 seconds per photo. It is a one-time cost per event.

---

## Tuning the matching

`FACE_MATCH_THRESHOLD` is the cosine similarity above which two faces are treated as the same
person. The default of `0.40` was measured, not guessed:

```bash
npm run calibrate -- "Some Event" 40
```

This compares every face against every face from other photos in an event and prints a histogram.
Real data is strongly bimodal — different people cluster below 0.30, the same person appears again
above 0.50 — and the threshold belongs in the empty gap between them.

**Recalibrate if you change models.** Scores from different models are not comparable.

Other useful checks:

```bash
npm run test:drive     # Drive credentials and folder structure
npm run test:heic      # HEIC conversion against real photos
npm run test:face      # detection rate, speed, and two sanity checks
npm run test:search -- "Some Event" ./my-selfies
npm test               # the unit test suite
```

---

## Deploying

The backend serves the built frontend in production, so it runs as **one** service on one origin.
That matters: split across two hosts, the login cookie becomes cross-site and browsers drop it.

```bash
npm run install:all && npm run build:frontend && npm run models:download
NODE_ENV=production node backend/src/server.js
```

Set the same environment variables as above, plus:

```env
NODE_ENV=production
GOOGLE_SERVICE_ACCOUNT_JSON=   # the key file's contents, for hosts with no file upload
```

Update the OAuth client to use your real domain for both the JavaScript origin and the redirect URI.

**Size the host properly.** Measured peak memory:

| | RSS |
|---|---|
| Models loaded | 351 MB |
| Running a search | 498 MB |
| Indexing a 12 MP photo | 685 MB |

A 512 MB instance is not enough. **1 GB is the practical minimum**, 2 GB is comfortable. The
database also needs to live on persistent storage — losing it means re-indexing every event.

`FACE_MODEL=small` loads a set roughly a tenth of the size, but it was measurably worse on real
event photos: on our test set it ranked two wrong people above the correct match. Use it only if
you have verified it works on *your* photos.

HTTPS is required in production — browsers will not open a camera on a plain `http://` page.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | |
| `DATABASE_URL` | `./data/photo_finder.db` | SQLite file |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | — | Folder containing one subfolder per event |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | — | Path to the service account JSON |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | The JSON itself; takes precedence over the file |
| `GOOGLE_CLIENT_ID` / `_SECRET` | — | Participant sign-in |
| `SESSION_SECRET` | random | Signs the login cookie; set it or logins reset on restart |
| `ADMIN_EMAILS` | empty | Comma-separated organizers |
| `FACE_MODEL` | `large` | `large` or `small` |
| `FACE_MATCH_THRESHOLD` | `0.40` | Cosine similarity for a match |
| `SEARCH_SESSION_TTL_MINUTES` | `120` | How long results stay reachable |
| `CORS_ORIGIN` | `http://localhost:5173` | Only used when the frontend is served separately |

---

## Privacy and access

- Participants sign in with Google; the Google account ID is the identity, not the email.
- A search records which photos it matched. Photos are served only to the account whose search
  found them, and only until that search expires.
- Selfies are taken with the camera rather than uploaded, so the site cannot easily be used to look
  up somebody else. This is a deterrent, not a guarantee — the enforceable controls are the login,
  a per-user rate limit, and the fact that every search is recorded against an account.
- Face embeddings are personal data. Think about who is in your photos, tell them this exists, and
  delete `data/photo_finder.db` if you stop running it.

---

## Known limitations

- **WhatsApp-forwarded photos rarely work.** They are compressed so heavily that faces can be under
  20 pixels wide. No model can recover that. Index the originals where you can.
- **Videos are ignored.** Only images are indexed.
- **Indexing is slow** — a few seconds per photo, single-threaded, one event at a time.
- **Small faces in large group shots** are the usual cause of a missed match.

---

## Project layout

```
backend/
  src/
    routes/      health, auth, events, photos, admin
    services/    googleDrive, faceRecognition, matching, indexing, indexQueue
    middleware/  auth, upload, rateLimit, errorHandler
    db/          schema.sql, queries.js, database.js
  scripts/       models:download, index, calibrate, test:drive, test:face, test:heic, test:search
  tests/
frontend/
  src/pages/     Login, Events, Event, Results, Admin, Help
docs/
  SPECIFICATION.md   the original product spec this was built from
```

Each external dependency sits behind one service, so swapping the face model, the storage provider,
or the database means editing one file rather than hunting through the codebase.

---

## Licence

MIT — see [LICENSE](LICENSE). Fork it, run it for your own club, change whatever you like.

Built by **Vayu Nandan Mishra** · [cs23vayu@rbmi.in](mailto:cs23vayu@rbmi.in)
