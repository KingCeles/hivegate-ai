# BeeCount v2 — React + Flask

## Features
- Login / Register with JWT auth
- Dashboard — daily, monthly, yearly bee count charts
- Identify bee — upload photo → AI identifies H.itama / G.thoracica / T.binghami
- Count video — upload video → click to draw line → get IN/OUT counts + download annotated video

---

## Setup — local development

### 1. Add your model files to backend/
```
backend/
  app.py
  requirements.txt
  bee_motion.pt      ← your counting model  (rename to bee_motion.pt)
  id_model.pt        ← your identification model (rename to id_model.pt)
```

### 2. Start backend
```bash
cd backend
pip install -r requirements.txt
python app.py
# Runs at http://localhost:5000
```

### 3. Start frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
# Runs at http://localhost:5173
```

### 4. Open browser
Go to http://localhost:5173
- Register an account
- Dashboard → click "Load demo data" to see charts
- Identify bee → upload a bee photo
- Count video → upload a hive video, click to draw the line

---

## Deploy as website + PWA

Use `DEPLOYMENT.md` for the current launch checklist. Recommended v1:
- frontend as a Vercel/Netlify website and installable PWA
- main Flask API as one backend service
- motion/counting Flask API as a second backend service
- managed Postgres through `DATABASE_URL`
- private owner dashboard at `/admin`

## Deploy to Railway (backend) + Vercel (frontend)

### Backend → Railway
1. Push backend/ folder to a GitHub repo
2. railway.app → New Project → Deploy from GitHub
3. Set environment variables in Railway:
   - JWT_SECRET = any-random-string
   - ID_MODEL = id_model.pt
   - COUNT_MODEL = bee_motion.pt
4. Upload your .pt files to the Railway deployment (via Railway CLI or include in repo)
5. Copy your Railway URL e.g. https://bee-backend.railway.app

### Frontend → Vercel
1. Create frontend/.env.local:
   VITE_API_URL=https://your-backend.railway.app
2. Push frontend/ folder to a GitHub repo
3. vercel.com → New Project → Import from GitHub
4. Add Environment Variable: VITE_API_URL = your Railway URL
5. Deploy

---

## Model file names
The backend expects:
- id_model.pt    → your 3-class bee identification model
- bee_motion.pt  → your single-class bee counting model

To use different filenames, set environment variables:
  ID_MODEL=your_id_model.pt
  COUNT_MODEL=your_count_model.pt

---

## Pi uploader (send counts to dashboard automatically)
Edit and run pi_uploader.py on your Raspberry Pi:
```python
SERVER_URL = "https://your-backend.railway.app"
EMAIL      = "your@email.com"
PASSWORD   = "yourpassword"
```
```bash
python pi_uploader.py
```
Uploads counts every 5 minutes automatically.

---

## YOLO annotation workflow

For bee counting, the extracted frames already live in:
- `backend/dataset/motion_candidates`
- `backend/dataset/sampled_frames`

Check how many images are already labeled:
```bash
python backend/annotate_yolo.py status
```

If you previously saved YOLO labels into `backend/dataset/label`, copy them back next to the images:
```bash
python backend/annotate_yolo.py sync
```

Launch `labelImg` for the motion-heavy frames and save YOLO labels next to each image:
```bash
python backend/annotate_yolo.py launch --source motion
```

After labeling, build the YOLO train/val dataset:
```bash
python backend/prepare_yolo_dataset.py
```

---

## FYP demo workflow

Use this path for a clean project demonstration:

1. Start all services:
```bash
python scripts/dev_runner.py
```

2. Confirm services:
```bash
curl http://localhost:5000/api/health
curl http://localhost:5001/api/health
```

3. Open the web app:
```bash
http://localhost:5173
```

4. Demo sequence:
- Login or register a demo account.
- Open Dashboard and check Demo Readiness.
- Open Live Count on the phone through the HTTPS tunnel.
- Rename the phone node to Hive 1.
- Start live tracking and confirm the node appears on Dashboard / Hardware.
- Run one controlled crossing trial.
- Enter manual ground-truth IN/OUT values in FYP Validation Trial.
- Export evidence JSON.
- Save session to generate a farmer report.
- Open AI Assistant and ask it to summarize the latest session.
