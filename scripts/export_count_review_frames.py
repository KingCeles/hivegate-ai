from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app2 import DEFAULT_CONFIG, KNOWN_TUNED_SETUPS, build_geometry, process_count_video  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the motion counter and export frames around counted events for manual review."
    )
    parser.add_argument("--video", default=str(ROOT / "MVI_2375.MP4"), help="Input video path.")
    parser.add_argument("--out", default=str(ROOT / "review_count_frames"), help="Output folder.")
    parser.add_argument("--limit-frames", type=int, default=0, help="Only process the first N frames. 0 means full video.")
    parser.add_argument("--context", type=int, default=2, help="Frames before/after each event to export.")
    parser.add_argument("--clip-context", type=int, default=18, help="Frames before/after each event for continuous review clips.")
    parser.add_argument("--clip-fps", type=float, default=12.0, help="FPS for exported review clips.")
    parser.add_argument("--sheet-cols", type=int, default=3, help="Columns in the contact sheet.")
    return parser.parse_args()


def make_clip(source: Path, limit_frames: int, out_dir: Path) -> Path:
    if limit_frames <= 0:
        return source

    clip_path = out_dir / f"{source.stem}_first_{limit_frames}.mp4"
    cap = cv2.VideoCapture(str(source))
    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f"Could not read {source}")

    height, width = frame.shape[:2]
    writer = cv2.VideoWriter(str(clip_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    writer.write(frame)
    written = 1
    while written < limit_frames:
        ok, frame = cap.read()
        if not ok:
            break
        writer.write(frame)
        written += 1

    cap.release()
    writer.release()
    return clip_path


def frame_at(video_path: Path, frame_number: int):
    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_number - 1))
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


def export_event_clip(video_path: Path, output_path: Path, event, context: int, fps: float) -> None:
    frame_number = int(event["frame"])
    start_frame = max(1, frame_number - context)
    end_frame = frame_number + context

    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame - 1)
    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (960, 540))

    current = start_frame
    while current <= end_frame:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.resize(frame, (960, 540))
        if current == frame_number:
            cv2.rectangle(frame, (0, 0), (960, 62), (0, 0, 0), -1)
            cv2.putText(
                frame,
                f"COUNT EVENT  frame {frame_number}  predicted {event.get('label', '?')}",
                (18, 38),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2,
            )
            cv2.rectangle(frame, (0, 0), (959, 539), (0, 220, 255), 6)
        else:
            cv2.rectangle(frame, (0, 0), (360, 42), (0, 0, 0), -1)
            cv2.putText(
                frame,
                f"frame {current}",
                (14, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (220, 220, 220),
                2,
            )
        writer.write(frame)
        current += 1

    cap.release()
    writer.release()


def annotate_review_frame(frame, event, actual_label: str | None = None):
    label = event.get("label", "?")
    frame_number = event.get("frame", "?")
    source = event.get("source", "")
    direction = event.get("direction_source", "")
    text = f"Frame {frame_number}  predicted {label}"
    if actual_label:
        text += f"  actual {actual_label}"

    canvas = cv2.resize(frame, (480, 270))
    cv2.rectangle(canvas, (0, 0), (480, 64), (0, 0, 0), -1)
    cv2.putText(canvas, text, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (255, 255, 255), 2)
    cv2.putText(
        canvas,
        f"{event.get('from', '?')} -> {event.get('to', '?')}  {source}  {direction}",
        (12, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.46,
        (0, 220, 255),
        1,
    )
    return canvas


def write_contact_sheet(images: list[np.ndarray], output_path: Path, cols: int) -> None:
    if not images:
        return

    cols = max(1, cols)
    blank = np.zeros_like(images[0])
    rows = []
    for index in range(0, len(images), cols):
        row = images[index:index + cols]
        while len(row) < cols:
            row.append(blank.copy())
        rows.append(np.hstack(row))
    cv2.imwrite(str(output_path), np.vstack(rows))


def clear_generated_files(directory: Path) -> None:
    for path in directory.iterdir():
        if path.is_file():
            path.unlink()


def main() -> int:
    args = parse_args()
    video_path = Path(args.video).resolve()
    out_dir = Path(args.out).resolve()
    frames_dir = out_dir / "frames"
    clips_dir = out_dir / "clips"
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)
    clear_generated_files(frames_dir)
    clear_generated_files(clips_dir)

    clip_path = make_clip(video_path, args.limit_frames, out_dir)
    counted_path = out_dir / f"{clip_path.stem}_counted.mp4"

    setup = KNOWN_TUNED_SETUPS.get(video_path.name.lower())
    if setup is None:
        setup = {
            "line_x1": 306,
            "line_y1": 0,
            "line_x2": 306,
            "line_y2": DEFAULT_CONFIG.height - 1,
            "hive_x": 236,
            "hive_y": DEFAULT_CONFIG.height // 2,
        }

    result = process_count_video(
        str(clip_path),
        str(counted_path),
        build_geometry(setup, DEFAULT_CONFIG),
        DEFAULT_CONFIG,
        True,
    )
    events = result["debug"]["counted_events"]

    with (out_dir / "count_result.json").open("w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

    rows = []
    sheet_images = []
    for event in events:
        frame_number = int(event["frame"])
        clip_name = f"event_frame_{frame_number:06d}_predicted_{event['label']}.mp4"
        export_event_clip(counted_path, clips_dir / clip_name, event, args.clip_context, args.clip_fps)

        for offset in range(-args.context, args.context + 1):
            review_frame = frame_at(counted_path, frame_number + offset)
            if review_frame is None:
                continue

            annotated = annotate_review_frame(review_frame, event)
            name = f"frame_{frame_number:06d}_{event['label']}_offset_{offset:+d}.jpg"
            cv2.imwrite(str(frames_dir / name), annotated)
            if offset == 0:
                sheet_images.append(annotated)

        rows.append({
            "frame": frame_number,
            "predicted": event.get("label", ""),
            "actual": "",
            "from": event.get("from", ""),
            "to": event.get("to", ""),
            "source": event.get("source", ""),
            "direction_source": event.get("direction_source", ""),
            "direction_delta": event.get("direction_delta", ""),
            "clip": f"clips/{clip_name}",
            "notes": "",
        })

    with (out_dir / "event_review.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "frame",
                "predicted",
                "actual",
                "from",
                "to",
                "source",
                "direction_source",
                "direction_delta",
                "clip",
                "notes",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    write_contact_sheet(sheet_images, out_dir / "event_contact_sheet.jpg", args.sheet_cols)

    if clip_path != video_path and clip_path.exists():
        clip_path.unlink()

    print(f"Counts: IN={result['total_in']} OUT={result['total_out']} frames={result['total_frames']}")
    print(f"Wrote review folder: {out_dir}")
    print(f"Open continuous clips in: {clips_dir}")
    print(f"Fill the 'actual' column in: {out_dir / 'event_review.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
