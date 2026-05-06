import csv
import os
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "debug_videos"
OUT_DIR = ROOT / "dataset"
SAMPLED_DIR = OUT_DIR / "sampled_frames"
MOTION_DIR = OUT_DIR / "motion_candidates"
META_PATH = OUT_DIR / "frame_index.csv"

SAMPLED_FPS = 2.0
MOTION_TOP_RATIO = 0.05
MIN_MOTION_GAP = 8
MIN_SHARPNESS = 8.0


def ensure_dirs():
    for path in [OUT_DIR, SAMPLED_DIR, MOTION_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def frame_sharpness(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def motion_score(prev_small, frame_small):
    diff = cv2.absdiff(prev_small, frame_small)
    return float(np.mean(diff))


def save_frame(folder, video_stem, frame_idx, frame):
    filename = f"{video_stem}_f{frame_idx:06d}.jpg"
    path = folder / filename
    cv2.imwrite(str(path), frame)
    return filename


def extract_video(video_path, writer):
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    sample_stride = max(1, int(round(fps / SAMPLED_FPS)))
    video_stem = video_path.stem

    print(f"Processing {video_path.name} ({total_frames} frames @ {fps:.2f} fps)")

    frame_idx = 0
    prev_small = None
    motion_rows = []

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_idx % sample_stride == 0:
            filename = save_frame(SAMPLED_DIR, video_stem, frame_idx, frame)
            writer.writerow({
                "video": video_path.name,
                "frame": frame_idx,
                "kind": "sampled",
                "filename": filename,
                "motion_score": "",
                "sharpness": f"{frame_sharpness(frame):.2f}",
            })

        gray_small = cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY)
        sharpness = frame_sharpness(frame)
        if prev_small is not None:
            score = motion_score(prev_small, gray_small)
            motion_rows.append((frame_idx, score, sharpness, frame.copy()))
        prev_small = gray_small
        frame_idx += 1

    cap.release()

    if not motion_rows:
        return

    motion_rows.sort(key=lambda item: item[1], reverse=True)
    target_count = max(40, int(total_frames * MOTION_TOP_RATIO))
    selected = []
    taken_frames = []

    for frame_idx, score, sharpness, frame in motion_rows:
        if sharpness < MIN_SHARPNESS:
            continue
        if any(abs(frame_idx - old_idx) < MIN_MOTION_GAP for old_idx in taken_frames):
            continue
        selected.append((frame_idx, score, sharpness, frame))
        taken_frames.append(frame_idx)
        if len(selected) >= target_count:
            break

    if len(selected) < max(20, target_count // 3):
        selected = []
        taken_frames = []
        for frame_idx, score, sharpness, frame in motion_rows:
            if any(abs(frame_idx - old_idx) < MIN_MOTION_GAP for old_idx in taken_frames):
                continue
            selected.append((frame_idx, score, sharpness, frame))
            taken_frames.append(frame_idx)
            if len(selected) >= target_count:
                break

    for frame_idx, score, sharpness, frame in sorted(selected, key=lambda item: item[0]):
        filename = save_frame(MOTION_DIR, video_stem, frame_idx, frame)
        writer.writerow({
            "video": video_path.name,
            "frame": frame_idx,
            "kind": "motion",
            "filename": filename,
            "motion_score": f"{score:.4f}",
            "sharpness": f"{sharpness:.2f}",
        })

    print(f"  saved {len(selected)} motion-heavy candidates")


def main():
    ensure_dirs()
    videos = sorted(
        path for path in VIDEO_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in {".mp4", ".mov", ".avi"}
    )
    if not videos:
        raise SystemExit("No videos found in backend/debug_videos")

    with META_PATH.open("w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(
            csvfile,
            fieldnames=["video", "frame", "kind", "filename", "motion_score", "sharpness"],
        )
        writer.writeheader()
        for video_path in videos:
            extract_video(video_path, writer)

    print(f"Done. Metadata written to {META_PATH}")


if __name__ == "__main__":
    main()
