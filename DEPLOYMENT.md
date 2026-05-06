# HiveGate AI Deployment Checklist

## Recommended v1 launch

Deploy as a responsive website first, then let users install it as a PWA from the browser. Do not build a native mobile app for v1.

## Frontend

Use Vercel or Netlify from the `frontend/` folder.

Required environment variables:

```env
VITE_API_URL=https://your-main-backend.example.com
VITE_COUNT_API_URL=https://your-motion-backend.example.com
```

If both Flask apps are served behind one reverse proxy, keep `VITE_COUNT_API_URL=/motion-api`.

For Vercel, the repo now includes `frontend/vercel.json`. Import the `frontend/` folder as the project root.

## Backend

Deploy `backend/app.py` as the main API and `backend/app2.py` as the motion/counting API. The current `backend/Procfile` is valid for the main API:

```bash
gunicorn app:app --bind 0.0.0.0:$PORT --timeout 600 --workers 1
```

For the motion API, use:

```bash
gunicorn app2:app --bind 0.0.0.0:$PORT --timeout 600 --workers 1
```

The repo includes:

- `backend/Procfile` for the main API
- `backend/Procfile.motion` for the motion API
- `render.yaml` as a Render blueprint for both APIs plus Postgres

Required backend environment variables:

```env
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://user:password@host:5432/beecount
ADMIN_EMAIL=owner@example.com
CORS_ORIGINS=https://your-frontend.example.com
ID_MODEL=id_model.pt
COUNT_MODEL=bee_motion.pt
YOLO_DEVICE=cpu
```

For the AI helper on Groq:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your-key
GROQ_MODEL=groq/compound-mini
```

## Owner admin

Keep `/admin`. It is hidden from normal users and protected by the backend. The owner account is:

- any email in `ADMIN_EMAIL`, or
- the first registered user if `ADMIN_EMAIL` is not set

Use the admin page to check total users, active users, saved records, reports, model paths, dataset size, live sessions, and recent backend errors.

## Public launch checks

- Run the local readiness check:

```bash
npm run check:deploy
```

- Register and login on the deployed domain.
- Confirm `/admin` returns `403` for a normal user.
- Upload one video and confirm progress, count result, saved record, and dashboard update.
- Open Live Camera on a phone over HTTPS and confirm camera permission works.
- Save one live session and confirm a report appears.
- Install the PWA from mobile browser and reopen it from the home screen.
