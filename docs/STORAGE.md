# Test-paper storage (PDFs)

Test papers are PDFs. PrepSetu deliberately supports **three** storage providers because institutes differ:
Firebase Storage (most common), a Cloudflare R2 bucket (no extra vendor), or an existing external https host.
The database stores only the URL and metadata — never the file.

---

## Choosing a provider

| | Firebase Storage | Cloudflare R2 | External https link |
| --- | --- | --- | --- |
| Extra setup | Firebase project + Storage Rules | `wrangler r2 bucket create` + binding | none |
| Upload path | Browser → Firebase (direct) | Browser → Worker (`multipart`) | upload elsewhere, paste URL |
| Size limit | Firebase/plan limits (we cap the form at 25 MB) | 32 MB per request (Worker) | whatever the host allows |
| Worker CPU cost | none | streams through the Worker | none |
| Deletion | browser/SDK deletes the object | Worker deletes on paper delete | never (external) |
| Best for | existing Firebase deployments | all-Cloudflare deployments | already-hosted archives |

`storage.test_paper_provider` and `storage.max_pdf_mb` (super-admin-only settings) record the intended choice so
the UI can explain it. The provider actually used is detected per file and stored in `test_papers.storage_provider`.

---

## Provider A — Firebase Storage (default)

> **Current state:** the admin console registers a PDF by **URL** — it does not ship a file picker that talks
> to Firebase Storage. Upload out-of-band (Firebase console, the `gsutil` command below, or your own script)
> and paste the resulting download URL into **Admin → Test papers → Register paper**. This keeps a 25 MB PDF
> off the Worker entirely.

The intended end state is a browser upload performed with the signed-in administrator's Firebase user, after
which the Worker registers the resulting URL.

**1. Create the bucket.** In the Firebase console → Storage → Get started (the default bucket is
`<project>.appspot.com`, newer projects use `<project>.firebasestorage.app`).

**2. Deploy Storage Rules** that let only staff write:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Test papers are written by admins only, read by anyone signed in.
    match /test-papers/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.auth.token.email_verified == true
                   && (request.auth.token.admin == true
                       || request.auth.token.role in ['admin', 'super_admin', 'content_manager', 'exam_manager']);
    }
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

> Firebase custom claims (`admin`, `role`) are managed by your Admin SDK workflow. If you do not use custom
> claims, gate on a path prefix that only staff know, **or** route uploads through the Worker instead — the
> security model must never rely on the client hiding a button.

**3. Set the CORS policy** so the browser can POST from your origin:

```bash
cat > cors.json <<'EOF'
[{
  "origin": ["https://prepsetu.example.com", "http://localhost:8799"],
  "method": ["GET", "HEAD", "POST", "PUT"],
  "maxAgeSeconds": 3600
}]
EOF
gcloud storage buckets update gs://<bucket> --cors-file=cors.json
```

**4. In Admin → Test papers → Register paper**, paste the download URL
(`https://firebasestorage.googleapis.com/v0/b/<bucket>/o/test-papers%2F…?alt=media&token=…`) and the size.
The Worker validates that it is `https`, infers `storage_provider = firebase`, and records the row.

---

## Provider B — R2 through the Worker

**1. Create the bucket and uncomment the binding** in `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "prepsetu-media" }]
```

**2. Upload** with the dedicated endpoint (multipart form field `file`):

```bash
curl -X POST https://<your-worker>/api/admin/test-papers/upload \
  -H "authorization: Bearer <admin-firebase-id-token>" \
  -F "file=@jee-main-2025-paper-1.pdf"
```

Response: `{ "fileUrl": "…/api/media/test-papers/2026-11/<uuid>.pdf", "fileKey": "…", "fileSizeBytes": 123456 }`.

**3. Register the metadata** with those three values (`POST /api/admin/test-papers`), then the paper appears in
the student library.

**Server-side validation on upload:** `MEDIA` must exist (otherwise `412 r2_not_configured`), content type must
be `application/pdf`, size ≤ 32 MB, and the first five bytes must be `%PDF-`. Deleting the paper also deletes
the object.

**Serving:** `GET /api/media/*` streams from R2 with `content-type: application/pdf`,
`content-disposition: inline`, a long `cache-control`, and `nosniff`. The path is not guessable (UUID), but it is
**not** access-controlled — treat media URLs as unlisted, not private. For gated papers, use Firebase Storage
with token URLs or add a signed-URL layer.

---

## Provider C — external link

Paste any `https://…pdf` URL. The Worker stores `storage_provider = 'external'` and never deletes it. Use this
for an existing institutional archive. `http://` is rejected.

---

## Limits and behaviour

| Rule | Value |
| --- | --- |
| Allowed scheme | `https` only |
| Recommended max size | 25 MB (`storage.max_pdf_mb`, capped at 80) |
| Worker upload hard cap | 32 MB |
| Accepted type | `application/pdf` (signature-checked on R2) |
| Rate limit | `RATE_LIMITS.upload` per administrator |
| Visibility | `public` · `authenticated` · `restricted` (per paper) |
| Free flag | `is_free` — free papers download without any entitlement check |

`test_papers` also stores `answer_key_url`, `solution_url`, `cover_image_url`, `year`, `category`,
`class_id`, `exam_type_id`, `subject_id`, and `status` (`draft | published | archived`) — drafts never appear
in the student library.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `412 r2_not_configured` | `MEDIA` binding absent | Uncomment it in `wrangler.jsonc` and redeploy |
| `400 Only https URLs are allowed` | `http://` link | Re-host on https |
| `400 The uploaded file is not a valid PDF` | renamed `.zip`/`.docx` | Re-export the PDF |
| `413` / `payload_too_large` | over 32 MB | Split the file or host externally |
| Upload works, student sees 403 | paper `visibility = restricted` | Change visibility or grant access |
| Firebase upload blocked by CORS | bucket CORS not set for the origin | Apply `cors.json` above |
| Paper downloads but is blank | Storage token expired / URL rewritten | Re-register the paper with a fresh URL |
