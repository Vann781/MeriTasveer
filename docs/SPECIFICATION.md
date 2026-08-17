# Event Photo Finder

A simple private web application that allows participants of club events to find photos of themselves from Google Drive using **three selfies taken from different angles**.

The organizer already stores event photos in Google Drive, organized into folders by event. The application should use Google Drive as the **source of truth** for all event photos.

The application must **never give participants direct access to the Google Drive folders**.

The goal is to build a simple, reliable MVP first. **Do not over-engineer the system.**

---

# 1. Core User Experience

The participant experience should be:

```text
Google Login
     ↓
View Events
     ↓
Select Event
     ↓
Upload 3 Selfies
     ↓
Face Matching
     ↓
Find Matching Photos
     ↓
Retrieve Photos from Google Drive
     ↓
View / Download Photos
```

Example:

```text
Participant logs in

        ↓

XYZ Fun Activity
Robotics Workshop
DSA Challenge

        ↓

Participant selects:

XYZ Fun Activity

        ↓

Upload:

Selfie 1 → Front
Selfie 2 → Left angle
Selfie 3 → Right angle

        ↓

System searches ONLY
the XYZ Fun Activity photos

        ↓

17 matching photos found

        ↓

Participant can view/download
those 17 photos
```

---

# 2. Existing Google Drive Structure

The organizer's Google Drive looks like:

```text
MechQuish Photos/
│
├── XYZ Fun Activity/
│   ├── IMG_001.jpg
│   ├── IMG_002.jpg
│   ├── IMG_003.jpg
│   └── ...
│
├── Robotics Workshop/
│   ├── IMG_101.jpg
│   ├── IMG_102.jpg
│   └── ...
│
└── DSA Challenge/
    ├── IMG_201.jpg
    ├── IMG_202.jpg
    └── ...
```

The root folder is configured through:

```env
GOOGLE_DRIVE_ROOT_FOLDER_ID=
```

Every direct subfolder inside the root folder represents an event.

For example:

```text
Google Drive Folder:
XYZ Fun Activity

Website:
XYZ Fun Activity
```

The application should automatically discover these event folders.

---

# 3. Important Architecture Rule

## Google Drive remains the photo storage.

Do NOT create another photo storage system.

The database stores:

```text
Event metadata
Photo metadata
Google Drive file IDs
Face embeddings
```

The database does NOT permanently store:

```text
Event photos
Participant selfies
```

Event photos remain in Google Drive.

Participant selfies should only exist temporarily during processing.

---

# 4. Technology Stack

## Frontend

Use:

- React
- Vite
- Tailwind CSS

The frontend should be responsive and primarily optimized for mobile because participants will likely use their phones.

---

## Backend

Use:

- Node.js
- Express.js

The backend handles:

- Authentication
- Google Drive API
- Event discovery
- Photo indexing
- Face recognition
- Face matching
- Database operations
- Secure image retrieval
- Download requests

---

## Database

Use:

**SQLite**

SQLite is sufficient for the MVP.

Use a simple database abstraction so it can be replaced by PostgreSQL later if required.

---

## Photo Storage

Use:

**Google Drive**

No S3.

No Cloudinary.

No Firebase Storage.

No local permanent photo storage.

Google Drive remains the source of truth.

---

# 5. Authentication

Participants should sign in using Google.

Flow:

```text
Participant
     ↓
Continue with Google
     ↓
Google OAuth
     ↓
Node.js backend
     ↓
Authenticated session
     ↓
Application
```

Store:

```text
google_user_id
email
name
profile_picture
```

The Google user ID should be used as the stable user identifier.

Do not use email as the primary user ID.

---

# 6. Google Drive Authentication

Google Drive access must happen entirely on the backend.

The frontend must NEVER contain:

```text
Google client secret
Service account credentials
Drive API credentials
OAuth secrets
```

Recommended architecture:

```text
                    ┌──────────────┐
                    │ Participant  │
                    └──────┬───────┘
                           │
                           ▼
                    React Frontend
                           │
                           ▼
                    Node.js Backend
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
          Google OAuth           Google Drive API
                                      │
                                      ▼
                               Organizer's Drive
```

Participants should never be given access to the organizer's Drive.

---

# 7. Participant Selfies

The participant must upload exactly **three selfies**.

The purpose of three selfies is to improve recognition accuracy across different:

- Angles
- Lighting conditions
- Expressions
- Face orientations

The UI should ask for:

```text
Selfie 1
Front-facing

Selfie 2
Turn slightly left

Selfie 3
Turn slightly right
```

Example:

```text
Find Your Photos

Upload 3 selfies for better accuracy.

┌──────────────────────┐
│       Selfie 1       │
│        Front         │
│                      │
│       Upload         │
└──────────────────────┘

┌──────────────────────┐
│       Selfie 2       │
│      Left Angle      │
│                      │
│       Upload         │
└──────────────────────┘

┌──────────────────────┐
│       Selfie 3       │
│     Right Angle      │
│                      │
│       Upload         │
└──────────────────────┘

       Find My Photos
```

All three selfies are required.

---

# 8. Selfie Validation

The backend must validate:

- File exists
- Valid image format
- Reasonable file size
- Image can be decoded
- A face exists
- Preferably exactly one face exists

Supported formats:

```text
JPG
JPEG
PNG
WEBP
```

If no face is detected:

```text
We couldn't detect a face in this selfie.

Please upload a clearer photo.
```

If multiple faces are detected:

```text
Please upload a selfie containing only you.
```

The participant's selfie should NOT be permanently stored.

---

# 9. Face Recognition

The application needs to:

1. Detect faces.
2. Generate face embeddings.
3. Compare embeddings.
4. Determine whether two faces belong to the same person.

The implementation must use a Node.js-compatible face recognition solution.

Possible technologies can include:

- `@vladmandic/face-api`
- TensorFlow.js-based face recognition
- Another reliable Node-compatible face embedding solution

Claude Code should evaluate the current Node.js ecosystem and choose a **practical, maintainable solution** rather than blindly installing an outdated package.

Do not introduce Python unless the Node.js implementation is genuinely impossible or unusably unreliable.

If a separate face-recognition service becomes absolutely necessary, document why before introducing it.

---

# 10. Event Photo Indexing

This is one of the most important parts of the architecture.

Do NOT scan and run face recognition on every Google Drive photo every time a participant searches.

Instead, event photos should be indexed once.

Flow:

```text
Google Drive
     ↓
Event Folder
     ↓
List Photos
     ↓
Download image temporarily
     ↓
Detect faces
     ↓
Generate embeddings
     ↓
Store embeddings in SQLite
     ↓
Delete temporary image
```

The original image remains in Google Drive.

---

# 11. Why Indexing Is Required

Suppose an event contains:

```text
500 photos
```

Without indexing:

```text
Participant searches
      ↓
Download 500 photos
      ↓
Analyze 500 photos
      ↓
Compare faces
```

This is slow and wastes Drive API requests.

With indexing:

```text
Admin indexes event once

500 photos
    ↓
Face embeddings stored

Participant searches
    ↓
Compare against embeddings
    ↓
Get matching Drive file IDs
    ↓
Retrieve only matched photos
```

This should be the default architecture.

---

# 12. Database Schema

Use SQLite.

Suggested tables:

## users

```text
id
google_user_id
email
name
profile_picture
created_at
```

---

## events

```text
id
drive_folder_id
name
status
created_at
indexed_at
```

Possible statuses:

```text
pending
indexing
ready
failed
```

---

## photos

```text
id
event_id
drive_file_id
file_name
mime_type
created_at
```

---

## face_embeddings

```text
id
photo_id
embedding
face_index
created_at
```

A single photo may contain multiple people.

Example:

```text
IMG_001.jpg

Face 1 → embedding
Face 2 → embedding
Face 3 → embedding
```

Do not assume one face per photo.

---

# 13. Embedding Storage

SQLite does not provide native vector storage.

For the MVP, embeddings can be stored as:

- JSON serialized arrays
- BLOB
- Another simple serialized format

Choose the simplest reliable implementation.

Do NOT introduce:

- Pinecone
- Weaviate
- Milvus
- Qdrant
- Redis Vector Search

for the MVP.

The expected number of photos is manageable.

---

# 14. Face Matching

When the participant uploads three selfies:

```text
Selfie 1
    ↓
Embedding 1

Selfie 2
    ↓
Embedding 2

Selfie 3
    ↓
Embedding 3
```

The backend then compares all three embeddings against the stored embeddings belonging to the selected event.

IMPORTANT:

**Only the selected event may be searched.**

Do not search all events.

---

# 15. Combining Three Selfies

Each selfie may produce a different set of matches.

Example:

```text
Selfie 1:
IMG001
IMG002
IMG005

Selfie 2:
IMG001
IMG002
IMG007

Selfie 3:
IMG001
IMG005
IMG007
```

Final result:

```text
IMG001
IMG002
IMG005
IMG007
```

Duplicates must be removed.

If multiple selfies match faces in the same photo, the photo should receive a stronger overall confidence.

Example:

```text
IMG001

Selfie 1 → strong match
Selfie 2 → strong match
Selfie 3 → strong match

Final → very strong match
```

The exact scoring mechanism should be cleanly implemented and documented.

---

# 16. Match Threshold

The matching threshold must be configurable.

Example:

```env
FACE_MATCH_THRESHOLD=0.55
```

The value shown above is only an initial configuration.

It must be tested against real event photos.

Do not blindly assume one threshold works for every recognition library.

The system should prioritize:

- Low false positives
- Good recall
- Practical results for event photography

---

# 17. Photo Retrieval From Google Drive

After face matching, the database will identify matching photos.

Example:

```text
Matched photo
      ↓
photo_id
      ↓
drive_file_id
      ↓
Google Drive API
      ↓
Image
```

The backend should retrieve the image from Google Drive.

The frontend should receive the image through the application's backend.

Do NOT expose:

```text
drive.google.com/...
```

to the participant.

---

# 18. Secure Photo Access

Every photo request must be authenticated and authorized.

For example:

```text
GET /api/photos/:photoId
```

must verify:

1. User is authenticated.
2. Photo exists.
3. Photo belongs to an event.
4. The photo was included in that user's authorized search results.

Do not trust a photo ID simply because it was supplied by the frontend.

A participant should not be able to change:

```text
/photo/123
```

to:

```text
/photo/124
```

and access someone else's photo unless they legitimately received it through their search.

---

# 19. Event Listing

The participant should see all available events discovered from Google Drive.

Example:

```text
Your Events

┌───────────────────────────┐
│ 🎉 XYZ Fun Activity       │
│                           │
│ Find My Photos →          │
└───────────────────────────┘

┌───────────────────────────┐
│ 🤖 Robotics Workshop      │
│                           │
│ Find My Photos →          │
└───────────────────────────┘
```

Do not expose internal Drive IDs.

---

# 20. Participant Pages

Minimum routes:

```text
/login
/events
/events/:eventId
/results
```

Flow:

```text
/login
   ↓
/events
   ↓
/events/:eventId
   ↓
Upload 3 selfies
   ↓
/results
```

---

# 21. Login Page

Simple design:

```text
MechQuish Event Photos

Find your photos from our events.

[ Continue with Google ]
```

Keep it minimal.

---

# 22. Events Page

Display event cards.

Example:

```text
Your Events

XYZ Fun Activity
[ Find My Photos ]

Robotics Workshop
[ Find My Photos ]

DSA Challenge
[ Find My Photos ]
```

---

# 23. Selfie Upload Page

Example:

```text
XYZ Fun Activity

Upload 3 selfies from different angles.

Selfie 1
Front
[ Upload ]

Selfie 2
Left
[ Upload ]

Selfie 3
Right
[ Upload ]

[ Find My Photos ]
```

Show previews after upload.

Disable the search button until all three selfies are uploaded and valid.

---

# 24. Loading State

Face recognition may take a few seconds.

Show something like:

```text
Finding your photos...

✓ Processing selfies
✓ Searching XYZ Fun Activity
○ Matching faces
○ Preparing photos

Please wait...
```

The UI must clearly indicate that processing is happening.

---

# 25. Results Page

Example:

```text
We found 17 photos of you 🎉

┌─────────┐ ┌─────────┐ ┌─────────┐
│  PHOTO  │ │  PHOTO  │ │  PHOTO  │
└─────────┘ └─────────┘ └─────────┘

┌─────────┐ ┌─────────┐ ┌─────────┐
│  PHOTO  │ │  PHOTO  │ │  PHOTO  │
└─────────┘ └─────────┘ └─────────┘
```

Each image should provide:

```text
View
Download
```

Do not show confidence scores to normal participants.

---

# 26. No Match Result

If no matching photos are found:

```text
We couldn't find any photos of you in this event.

Try uploading clearer selfies from different angles.
```

Allow the participant to return and upload new selfies.

---

# 27. Admin Functionality

The organizer needs a very simple admin interface.

Example:

```text
Admin Dashboard

Events

XYZ Fun Activity
238 photos
Status: Ready

[ Re-index ]

Robotics Workshop
174 photos
Status: Not Indexed

[ Index Photos ]
```

The admin should be able to:

- View events
- See indexing status
- Index an event
- Re-index an event

Do not build a complicated CMS.

---

# 28. Admin Authentication

For the MVP, use an environment-variable-based admin allowlist.

Example:

```env
ADMIN_EMAILS=organizer@example.com
```

After Google login:

```text
if authenticated user's email
is in ADMIN_EMAILS

→ allow admin access
```

Do not build complex role management.

---

# 29. Indexing Process

When admin clicks:

```text
Index Photos
```

the backend should:

1. Get event folder ID.
2. List all files.
3. Filter supported image formats.
4. Download each image temporarily.
5. Detect faces.
6. Generate embeddings.
7. Store photo metadata.
8. Store face embeddings.
9. Delete temporary image.
10. Mark event as `ready`.

The original photo stays in Google Drive.

---

# 30. Re-indexing

If photos are added later, the organizer should be able to re-index.

Re-indexing can initially use the simplest safe approach:

```text
Delete existing event index
        ↓
Read current Drive folder
        ↓
Process all current photos
        ↓
Create new index
```

This is acceptable for the MVP.

Do not build complicated incremental synchronization unless needed.

---

# 31. Temporary Image Handling

Event photos may be downloaded temporarily to process faces.

Example:

```text
Google Drive
     ↓
Temporary local file
     ↓
Face processing
     ↓
Embedding saved
     ↓
Temporary file deleted
```

Never leave event images permanently on the backend server.

---

# 32. Participant Selfie Handling

Participant selfies should be even more strictly handled.

Recommended flow:

```text
Upload selfie
     ↓
Memory / temporary file
     ↓
Face detection
     ↓
Generate embedding
     ↓
Match
     ↓
Delete selfie
```

Do not permanently store the selfie.

Do not save it to Google Drive.

Do not save it to the database.

---

# 33. API Design

Suggested endpoints:

```text
GET    /api/auth/me

GET    /api/events
GET    /api/events/:eventId

POST   /api/events/:eventId/search

GET    /api/photos/:photoId
GET    /api/photos/:photoId/download

GET    /api/admin/events
POST   /api/admin/events/:eventId/index
```

The exact API design can be adjusted if a simpler structure is better.

---

# 34. Search API

Endpoint:

```text
POST /api/events/:eventId/search
```

Input:

```text
multipart/form-data

selfie1
selfie2
selfie3
```

Backend process:

```text
Authenticate user
        ↓
Validate event
        ↓
Validate selfies
        ↓
Detect faces
        ↓
Generate 3 embeddings
        ↓
Load embeddings for selected event
        ↓
Compare faces
        ↓
Rank matches
        ↓
Remove duplicates
        ↓
Return matched photo IDs
```

Example response:

```json
{
  "event": {
    "id": "event_123",
    "name": "XYZ Fun Activity"
  },
  "matches": [
    {
      "photoId": "photo_123"
    },
    {
      "photoId": "photo_456"
    }
  ]
}
```

Do not expose Google Drive credentials or unnecessary internal metadata.

---

# 35. Search Result Authorization

Search results should be tied to the authenticated participant.

A simple MVP approach:

```text
search_sessions

id
user_id
event_id
expires_at
```

When a search is completed:

```text
User
 ↓
Search Session
 ↓
Matched Photos
```

The photo endpoint verifies that the photo belongs to a valid search session for that user.

Search sessions should expire after a reasonable period.

---

# 36. Security Requirements

Never expose:

```text
GOOGLE_CLIENT_SECRET
Google service account credentials
OAuth secrets
.env
Face embeddings
Database
```

to the frontend.

Add to `.gitignore`:

```text
.env
*.db
node_modules/
uploads/
temp/
credentials/
```

Never commit Google credentials.

---

# 37. Privacy Requirements

This application processes facial information.

The application should follow these principles:

- Participant selfies are temporary.
- Participant selfies are deleted after processing.
- Face embeddings generated from participant selfies should not be permanently stored.
- Event face embeddings are stored only to support the event-photo search system.
- Google Drive folders remain private.
- Google Drive URLs are not exposed.
- Participants can only access photos returned by their own search.
- Participants can only search the event they selected.

Add a simple privacy notice:

> Your uploaded selfies are used only to find your event photos and are not permanently stored.

---

# 38. Performance Requirements

MVP assumptions:

- Hundreds of photos per event.
- Potentially thousands of photos across all events.
- Small number of simultaneous users.

Do not optimize prematurely.

However:

- Index event photos once.
- Do not repeatedly process the same photos.
- Search only the selected event.
- Avoid unnecessary Google Drive API calls.
- Retrieve only matched images after search.
- Use reasonable database queries.

---

# 39. Project Structure

Use a clean structure similar to:

```text
event-photo-finder/
│
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── app.js
│   │   ├── config.js
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── events.js
│   │   │   ├── photos.js
│   │   │   └── admin.js
│   │   │
│   │   ├── services/
│   │   │   ├── googleDrive.js
│   │   │   ├── faceRecognition.js
│   │   │   ├── matching.js
│   │   │   └── indexing.js
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   └── admin.js
│   │   │
│   │   ├── db/
│   │   │   ├── database.js
│   │   │   └── schema.sql
│   │   │
│   │   └── utils/
│   │
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── App.jsx
│   │   └── main.jsx
│   │
│   ├── package.json
│   └── .env.example
│
├── README.md
├── .gitignore
└── package.json
```

Keep the project structure simple.

Do not create unnecessary abstractions.

---

# 40. Environment Variables

Backend `.env.example`:

```env
NODE_ENV=development

PORT=5000

DATABASE_URL=./data/photo_finder.db

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

GOOGLE_DRIVE_ROOT_FOLDER_ID=

ADMIN_EMAILS=

FACE_MATCH_THRESHOLD=0.55

SESSION_SECRET=
```

Frontend `.env.example`:

```env
VITE_API_URL=http://localhost:5000
```

Never commit actual values.

---

# 41. Development Phases

Do NOT attempt to build everything simultaneously.

Build in phases.

---

## Phase 1 — Project Setup

Create:

```text
React + Vite frontend
Node + Express backend
SQLite database
Environment configuration
```

Verify both applications run.

---

## Phase 2 — Google Drive Integration

Before building face recognition, make Google Drive work.

Implement:

```text
Connect to Google Drive
        ↓
Read root folder
        ↓
List event folders
        ↓
List photos in event
        ↓
Download one photo temporarily
```

Create a simple test endpoint or script.

Example:

```text
GET /api/events
```

should return:

```json
[
  {
    "id": "event_1",
    "name": "XYZ Fun Activity"
  },
  {
    "id": "event_2",
    "name": "Robotics Workshop"
  }
]
```

---

# 42. Phase 3 — Face Recognition

Before integrating everything:

Create a small face-recognition test.

Input:

```text
selfie1.jpg
selfie2.jpg
selfie3.jpg
photo.jpg
```

Output:

```text
Face detected
Embedding generated
Similarity calculated
Match: true/false
```

Test using real event photos.

Do not proceed until the chosen Node.js face recognition implementation is working reliably.

---

# 43. Phase 4 — Event Indexing

Implement:

```text
Google Drive Event
        ↓
Photos
        ↓
Face Detection
        ↓
Embeddings
        ↓
SQLite
```

Test with one real event.

---

# 44. Phase 5 — Search

Implement:

```text
3 selfies
      ↓
3 embeddings
      ↓
Selected event embeddings
      ↓
Similarity comparison
      ↓
Matched photos
```

Make sure the search does NOT accidentally inspect other events.

---

# 45. Phase 6 — Secure Google Drive Retrieval

Implement:

```text
Matched photo
      ↓
Drive file ID
      ↓
Google Drive API
      ↓
Backend
      ↓
Participant
```

Verify that participants cannot discover the underlying Drive URL.

---

# 46. Phase 7 — Authentication

Add Google login.

Participant:

```text
Google Login
      ↓
Authenticated session
      ↓
Events
```

Admin:

```text
Google Login
      ↓
Email checked against ADMIN_EMAILS
      ↓
Admin dashboard
```

---

# 47. Phase 8 — Frontend

Build:

```text
Login
 ↓
Events
 ↓
Event Details
 ↓
3 Selfie Uploads
 ↓
Searching
 ↓
Results
```

Prioritize usability over visual complexity.

---

# 48. Phase 9 — Admin

Build:

```text
Admin Dashboard
      ↓
Events
      ↓
Index
      ↓
Ready
      ↓
Re-index
```

---

# 49. Testing

Create tests for critical functionality.

## Google Drive

Test:

- Root folder access.
- Event folder discovery.
- Photo discovery.
- Photo retrieval.

## Face recognition

Test:

- Valid face.
- No face.
- Multiple faces.
- Matching face.
- Non-matching face.

## Search

Test:

- Three selfies required.
- Invalid selfie rejected.
- Duplicate matches removed.
- Only selected event searched.

## Security

Test:

- Unauthenticated request rejected.
- User cannot access arbitrary photo.
- User cannot access another user's search result.
- Drive credentials never appear in API responses.
- Google Drive URL is not exposed.

---

# 50. Important Implementation Principles

Keep external integrations isolated.

For example:

```javascript
class GoogleDriveService {
    async listEvents() {}
    async listPhotos(eventFolderId) {}
    async downloadFile(fileId) {}
}
```

Face recognition should be isolated:

```javascript
class FaceRecognitionService {
    async detectFace(image) {}
    async generateEmbedding(image) {}
    async compareEmbeddings(a, b) {}
}
```

Matching logic should be isolated:

```javascript
class MatchingService {
    async findMatches(selfieEmbeddings, eventId) {}
}
```

This allows individual technologies to be replaced later.

---

# 51. Error Handling

Never expose stack traces to users.

### No face

```text
We couldn't detect your face.

Please upload a clearer selfie.
```

### Multiple faces

```text
Please upload selfies containing only you.
```

### No matches

```text
We couldn't find any photos of you in this event.

Try uploading clearer selfies from different angles.
```

### Event not indexed

```text
This event is still being prepared.

Please try again later.
```

### Google Drive failure

```text
We couldn't retrieve the photos right now.

Please try again later.
```

---

# 52. What NOT to Build

This project is intentionally simple.

Do NOT add:

- Mobile app
- Microservices
- Kubernetes
- Redis
- AWS
- Complex cloud architecture
- Payment system
- Chatbot
- Social feed
- Messaging
- Notifications
- Recommendation engine
- AI photo enhancement
- Separate image storage
- Vector database
- Complex admin roles
- Advanced analytics
- Multi-organization architecture
- Facial recognition across all events at once

These may be considered later.

---

# 53. Future Extensions

Keep the architecture reasonably extensible for:

- PostgreSQL
- Better face-recognition models
- Vector database
- Background indexing workers
- Automatic Drive synchronization
- Multiple organizers
- Multiple clubs
- QR codes for events
- Bulk photo downloads
- Favorites
- Event analytics
- CDN/image caching
- Cloud deployment

Do not implement these in the MVP.

---

# 54. Definition of Done

The MVP is complete when this works end-to-end.

### Organizer

```text
Google Drive

MechQuish Photos/
    │
    ├── XYZ Fun Activity/
    │       ├── IMG001.jpg
    │       ├── IMG002.jpg
    │       └── ...
    │
    └── Robotics Workshop/
            ├── IMG101.jpg
            └── ...
```

Admin opens:

```text
Admin Dashboard
       ↓
XYZ Fun Activity
       ↓
Index Photos
       ↓
Ready
```

---

### Participant

```text
Website
   ↓
Continue with Google
   ↓
Events
   ↓
XYZ Fun Activity
   ↓
Upload Selfie 1
Upload Selfie 2
Upload Selfie 3
   ↓
Find My Photos
   ↓
Face Matching
   ↓
17 Matches
   ↓
Photos retrieved from Google Drive
   ↓
View / Download
```

The participant must NEVER receive direct access to the Google Drive folder.

---

# 55. Claude Code Instructions

You are implementing this application based on this specification.

Follow these rules strictly:

1. **Do not over-engineer.**
2. Use Node.js + Express for the backend.
3. Use React + Vite for the frontend.
4. Use SQLite for the MVP database.
5. Google Drive is the source of truth for photos.
6. Do not introduce another photo storage provider.
7. Use exactly three selfies for participant searches.
8. Search only the selected event.
9. Index event photos rather than processing them on every search.
10. Do not permanently store participant selfies.
11. Do not expose Google Drive URLs.
12. Do not expose Google credentials to the frontend.
13. Keep secrets in environment variables.
14. Keep Google Drive logic isolated in a service.
15. Keep face recognition isolated in a service.
16. Keep matching logic isolated in a service.
17. Keep the frontend mobile-friendly.
18. Prefer simple solutions.
19. Avoid unnecessary dependencies.
20. Do not implement future features unless required for the MVP.
21. Add basic tests for critical functionality.
22. Handle errors cleanly.
23. Never expose stack traces to users.
24. Do not assume one photo contains only one face.
25. Do not assume one selfie is enough — the system requires three.

---

# 56. First Task

Before implementing the entire application:

### Step 1

Inspect the repository.

Determine:

- Existing files
- Existing project
- Existing dependencies
- Existing code
- Whether React/Vite or Node already exists

Do not overwrite useful existing code.

### Step 2

Create or update the project structure.

### Step 3

Set up:

```text
Node.js
Express
React
Vite
SQLite
Environment configuration
```

### Step 4

Implement Google Drive integration FIRST.

The first working milestone should be:

```text
Node backend
      ↓
Google Drive API
      ↓
Configured root folder
      ↓
List event folders
      ↓
List photos inside an event
      ↓
Retrieve one photo
```

Create a simple test to verify this works.

### Step 5

Only after Google Drive integration works, move to face recognition.

Do not build the entire system in one giant implementation step.

---

# Final Product Goal

The entire application should ultimately feel like this:

```text
┌───────────────────────────────┐
│                               │
│     MechQuish Event Photos    │
│                               │
│     Find your event photos    │
│                               │
│     [ Continue with Google ]  │
│                               │
└───────────────────────────────┘

                ↓

┌───────────────────────────────┐
│          Your Events          │
│                               │
│  🎉 XYZ Fun Activity          │
│     [ Find My Photos ]        │
│                               │
│  🤖 Robotics Workshop         │
│     [ Find My Photos ]        │
│                               │
└───────────────────────────────┘

                ↓

┌───────────────────────────────┐
│      XYZ Fun Activity         │
│                               │
│  Upload 3 selfies             │
│                               │
│  [ Selfie 1 ]                 │
│  [ Selfie 2 ]                 │
│  [ Selfie 3 ]                 │
│                               │
│     [ Find My Photos ]        │
└───────────────────────────────┘

                ↓

        🔍 Finding your photos...

                ↓

┌───────────────────────────────┐
│                               │
│   We found 17 photos of you!  │
│                               │
│  [IMG] [IMG] [IMG]            │
│  [IMG] [IMG] [IMG]            │
│  [IMG] [IMG] [IMG]            │
│                               │
│       [ Download ]            │
│                               │
└───────────────────────────────┘
```

The organizer continues using Google Drive exactly as before.

**Simple for the organizer.  
Simple for the participant.  
Google Drive remains the photo storage.  
Three selfies improve matching accuracy.  
Node.js handles the entire backend.**

Build the MVP first. Make it work reliably. Then improve it.