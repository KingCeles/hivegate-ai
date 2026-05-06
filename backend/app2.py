from dataclasses import asdict, dataclass, replace
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import cv2
import numpy as np
import os
import tempfile

try:
    import functools
    import torch
    from ultralytics import YOLO

    torch.load = functools.partial(torch.load, weights_only=False)
except Exception:
    YOLO = None
    torch = None


def parse_cors_origins():
    raw = os.environ.get("CORS_ORIGINS", "")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://*.vercel.app",
        "https://*.netlify.app",
        "https://*.trycloudflare.com",
    ]


app = Flask(__name__)
CORS(app, origins=parse_cors_origins())
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1GB max upload

COUNT_MODEL_PATH = os.environ.get(
    "COUNT_MODEL",
    "bee_motion_reviewed.pt" if os.path.exists("bee_motion_reviewed.pt") else "bee_motion.pt",
)
YOLO_DEVICE = os.environ.get("YOLO_DEVICE", "cuda:0" if torch is not None and torch.cuda.is_available() else "cpu")
_hybrid_model = None


def get_hybrid_model():
    global _hybrid_model
    if YOLO is None:
        raise RuntimeError("ultralytics is not available in this environment")
    if _hybrid_model is None:
        _hybrid_model = YOLO(COUNT_MODEL_PATH)
        _hybrid_model.to(YOLO_DEVICE)
        app.logger.info("Loaded hybrid YOLO model %s on %s", COUNT_MODEL_PATH, YOLO_DEVICE)
    return _hybrid_model


@dataclass
class MotionDiffConfig:
    width: int = 960
    height: int = 540
    blur_kernel: int = 3
    diff_threshold: int = 3
    close_kernel: int = 5
    dilate_kernel: int = 3
    dilate_iterations: int = 3
    min_contour_area: int = 2
    max_contour_area: int = 1800
    max_large_motion_width: int = 180
    max_large_motion_height: int = 120
    max_detections_per_frame: int = 80
    max_track_distance: int = 70
    fast_track_distance: int = 180
    max_parallel_jump: int = 120
    dark_threshold: int = 135
    max_dark_motion_width: int = 220
    max_dark_motion_height: int = 130
    min_dark_motion_area: int = 4
    max_dark_motion_area: int = 9000
    stale_frames: int = 12
    min_track_age: int = 2
    line_margin: int = 6
    cooldown_frames: int = 10
    side_confirm_frames: int = 1
    rearm_center_frames: int = 1
    min_crossing_distance: int = 8
    min_perpendicular_motion: int = 12
    open_side_min_distance: int = 42
    max_count_distance: int = 320
    rearm_side_distance: int = 24
    perpendicular_ratio: int = 1
    preview_width: int = 220
    preview_height: int = 140


DEFAULT_CONFIG = MotionDiffConfig()
DEFAULT_TUNED_MOTION_SETUP = {
    "line_x1": 306,
    "line_y1": 0,
    "line_x2": 306,
    "line_y2": 539,
    "hive_x": 236,
    "hive_y": 270,
    "label": "Default tuned open-air gate",
}
KNOWN_TUNED_SETUPS = {
    "mvi_2375.mp4": {
        **DEFAULT_TUNED_MOTION_SETUP,
        "label": "Tuned preset for MVI_2375 (open-air gate)",
    }
}


def clamp_int(value, minimum, maximum):
    return max(minimum, min(maximum, int(value)))


def odd_int(value, minimum, maximum):
    value = clamp_int(value, minimum, maximum)
    return value if value % 2 == 1 else value + 1


def read_int(form, key, default, minimum, maximum, odd=False):
    raw = form.get(key)
    if raw in (None, ""):
        value = default
    else:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            value = default
    return odd_int(value, minimum, maximum) if odd else clamp_int(value, minimum, maximum)


def build_runtime_config(form):
    return MotionDiffConfig(
        width=DEFAULT_CONFIG.width,
        height=DEFAULT_CONFIG.height,
        blur_kernel=read_int(form, "blur_kernel", DEFAULT_CONFIG.blur_kernel, 1, 15, odd=True),
        diff_threshold=read_int(form, "diff_threshold", DEFAULT_CONFIG.diff_threshold, 1, 255),
        close_kernel=read_int(form, "close_kernel", DEFAULT_CONFIG.close_kernel, 1, 31, odd=True),
        dilate_kernel=read_int(form, "dilate_kernel", DEFAULT_CONFIG.dilate_kernel, 1, 31, odd=True),
        dilate_iterations=read_int(form, "dilate_iterations", DEFAULT_CONFIG.dilate_iterations, 1, 10),
        min_contour_area=read_int(form, "min_contour_area", DEFAULT_CONFIG.min_contour_area, 1, 50000),
        max_contour_area=read_int(form, "max_contour_area", DEFAULT_CONFIG.max_contour_area, 1, 100000),
        max_large_motion_width=read_int(
            form, "max_large_motion_width", DEFAULT_CONFIG.max_large_motion_width, 1, 500
        ),
        max_large_motion_height=read_int(
            form, "max_large_motion_height", DEFAULT_CONFIG.max_large_motion_height, 1, 500
        ),
        max_detections_per_frame=read_int(
            form, "max_detections_per_frame", DEFAULT_CONFIG.max_detections_per_frame, 1, 200
        ),
        max_track_distance=read_int(form, "max_track_distance", DEFAULT_CONFIG.max_track_distance, 1, 300),
        fast_track_distance=read_int(form, "fast_track_distance", DEFAULT_CONFIG.fast_track_distance, 1, 500),
        max_parallel_jump=read_int(form, "max_parallel_jump", DEFAULT_CONFIG.max_parallel_jump, 1, 500),
        dark_threshold=read_int(form, "dark_threshold", DEFAULT_CONFIG.dark_threshold, 1, 255),
        max_dark_motion_width=read_int(
            form, "max_dark_motion_width", DEFAULT_CONFIG.max_dark_motion_width, 1, 500
        ),
        max_dark_motion_height=read_int(
            form, "max_dark_motion_height", DEFAULT_CONFIG.max_dark_motion_height, 1, 500
        ),
        min_dark_motion_area=read_int(
            form, "min_dark_motion_area", DEFAULT_CONFIG.min_dark_motion_area, 1, 5000
        ),
        max_dark_motion_area=read_int(
            form, "max_dark_motion_area", DEFAULT_CONFIG.max_dark_motion_area, 1, 50000
        ),
        stale_frames=read_int(form, "stale_frames", DEFAULT_CONFIG.stale_frames, 1, 60),
        min_track_age=read_int(form, "min_track_age", DEFAULT_CONFIG.min_track_age, 1, 30),
        line_margin=read_int(form, "line_margin", DEFAULT_CONFIG.line_margin, 1, 100),
        cooldown_frames=read_int(form, "cooldown_frames", DEFAULT_CONFIG.cooldown_frames, 1, 60),
        side_confirm_frames=read_int(
            form, "side_confirm_frames", DEFAULT_CONFIG.side_confirm_frames, 1, 10
        ),
        rearm_center_frames=read_int(
            form, "rearm_center_frames", DEFAULT_CONFIG.rearm_center_frames, 1, 10
        ),
        min_crossing_distance=read_int(
            form, "min_crossing_distance", DEFAULT_CONFIG.min_crossing_distance, 1, 120
        ),
        min_perpendicular_motion=read_int(
            form, "min_perpendicular_motion", DEFAULT_CONFIG.min_perpendicular_motion, 1, 200
        ),
        open_side_min_distance=read_int(
            form, "open_side_min_distance", DEFAULT_CONFIG.open_side_min_distance, 1, 250
        ),
        max_count_distance=read_int(
            form, "max_count_distance", DEFAULT_CONFIG.max_count_distance, 20, 600
        ),
        rearm_side_distance=read_int(
            form, "rearm_side_distance", DEFAULT_CONFIG.rearm_side_distance, 1, 250
        ),
        perpendicular_ratio=read_int(
            form, "perpendicular_ratio", DEFAULT_CONFIG.perpendicular_ratio, 1, 10
        ),
        preview_width=DEFAULT_CONFIG.preview_width,
        preview_height=DEFAULT_CONFIG.preview_height,
    )


def clamp_point(x, y, config):
    return (
        max(0, min(config.width - 1, int(x))),
        max(0, min(config.height - 1, int(y))),
    )


def build_default_tuned_motion_setup(config, label=None):
    base_width = DEFAULT_CONFIG.width
    base_height = DEFAULT_CONFIG.height
    scale_x = config.width / base_width
    scale_y = config.height / base_height
    return {
        "line_x1": clamp_int(round(DEFAULT_TUNED_MOTION_SETUP["line_x1"] * scale_x), 0, config.width - 1),
        "line_y1": 0,
        "line_x2": clamp_int(round(DEFAULT_TUNED_MOTION_SETUP["line_x2"] * scale_x), 0, config.width - 1),
        "line_y2": config.height - 1,
        "hive_x": clamp_int(round(DEFAULT_TUNED_MOTION_SETUP["hive_x"] * scale_x), 0, config.width - 1),
        "hive_y": clamp_int(round(DEFAULT_TUNED_MOTION_SETUP["hive_y"] * scale_y), 0, config.height - 1),
        "label": label or DEFAULT_TUNED_MOTION_SETUP["label"],
    }


def flight_path_gate_from_profile(profile, hive_edge, hive_side, config):
    open_sign = 1 if hive_side == "left" else -1
    min_line_gap = max(64, config.open_side_min_distance + 18)
    max_line_gap = min(config.max_count_distance, max(180, config.open_side_min_distance * 4))
    start_x = hive_edge + (open_sign * min_line_gap)
    end_x = hive_edge + (open_sign * max_line_gap)
    if hive_side == "left":
        start_x = clamp_int(start_x, 0, config.width - 1)
        end_x = clamp_int(end_x, start_x, config.width - 1)
        indices = np.arange(start_x, end_x + 1)
    else:
        start_x = clamp_int(start_x, 0, config.width - 1)
        end_x = clamp_int(end_x, 0, start_x)
        indices = np.arange(start_x, end_x - 1, -1)

    if indices.size == 0:
        return None, {
            "gate_method": "no_candidate_region",
            "path_motion_score": 0.0,
            "path_start_gap": min_line_gap,
            "path_end_gap": max_line_gap,
        }

    segment = profile[indices].astype(np.float64)
    total = float(segment.sum())
    if total <= 0:
        return None, {
            "gate_method": "no_path_motion",
            "path_motion_score": total,
            "path_start_gap": min_line_gap,
            "path_end_gap": max_line_gap,
        }

    threshold = max(
        float(np.percentile(segment, 75)),
        float(segment.mean() * 1.05),
        float(segment.max() * 0.30),
        20.0,
    )
    min_band_width = 4
    best_band = None
    band_start = None
    for offset, value in enumerate(segment):
        if value >= threshold and band_start is None:
            band_start = offset
        if band_start is not None and (value < threshold or offset == segment.size - 1):
            band_end = offset - 1 if value < threshold else offset
            if band_end - band_start + 1 >= min_band_width:
                band_values = segment[band_start : band_end + 1]
                best_band = {
                    "start_offset": band_start,
                    "end_offset": band_end,
                    "score": float(band_values.sum()),
                    "peak": float(band_values.max()),
                }
                break
            band_start = None

    if best_band is not None:
        post_band_gap = max(config.line_margin + 2, 8)
        line_offset = min(best_band["end_offset"] + post_band_gap, indices.size - 1)
        line_x = int(indices[line_offset])
        return line_x, {
            "gate_method": "first_open_motion_band",
            "path_motion_score": round(total, 1),
            "path_start_gap": min_line_gap,
            "path_end_gap": max_line_gap,
            "path_band_start_x": int(indices[best_band["start_offset"]]),
            "path_band_end_x": int(indices[best_band["end_offset"]]),
            "path_band_threshold": round(threshold, 1),
            "path_band_score": round(best_band["score"], 1),
            "path_band_peak": round(best_band["peak"], 1),
        }

    cumulative = np.cumsum(segment) / total
    fallback_offset = int(np.searchsorted(cumulative, 0.35))
    line_x = int(indices[min(fallback_offset, indices.size - 1)])
    return line_x, {
        "gate_method": "path_quantile_fallback",
        "path_motion_score": round(total, 1),
        "path_start_gap": min_line_gap,
        "path_end_gap": max_line_gap,
        "path_quantile": 0.35,
        "path_band_threshold": round(threshold, 1),
    }


def suggest_motion_setup(video_path, config):
    tuned_default = build_default_tuned_motion_setup(config)
    cap = cv2.VideoCapture(video_path)
    prev_gray = None
    first_gray = None
    motion_hist = np.zeros(config.width, dtype=np.float32)
    processed = 0

    try:
        while processed < 90:
            ok, frame = cap.read()
            if not ok:
                break

            frame = cv2.resize(frame, (config.width, config.height))
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (5, 5), 0)
            if first_gray is None:
                first_gray = gray.copy()

            if prev_gray is not None:
                diff = cv2.absdiff(prev_gray, gray)
                _, diff = cv2.threshold(diff, 12, 255, cv2.THRESH_BINARY)
                diff = cv2.morphologyEx(
                    diff,
                    cv2.MORPH_OPEN,
                    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
                )
                motion_hist += diff.sum(axis=0) / 255.0
                processed += 1

            prev_gray = gray
    finally:
        cap.release()

    if motion_hist.max() <= 0:
        return tuned_default

    if first_gray is not None:
        darkness = 255.0 - first_gray.astype(np.float32)
        dark_profile = darkness.mean(axis=0)
        dark_profile = np.convolve(
            dark_profile,
            np.ones(41, dtype=np.float32) / 41.0,
            mode="same",
        )
        edge_band = max(40, config.width // 5)
        left_strength = float(dark_profile[:edge_band].mean())
        right_strength = float(dark_profile[-edge_band:].mean())
        hive_side = "left" if left_strength >= right_strength else "right"

        if hive_side == "left":
            section = dark_profile[: config.width // 2]
            threshold = max(section.mean() * 1.05, section.max() * 0.35)
            candidates = np.where(section >= threshold)[0]
            hive_edge = int(candidates[-1]) if len(candidates) else int(config.width * 0.12)
        else:
            section = dark_profile[config.width // 2 :]
            threshold = max(section.mean() * 1.05, section.max() * 0.35)
            candidates = np.where(section >= threshold)[0]
            hive_edge = (
                int((config.width // 2) + candidates[0])
                if len(candidates)
                else int(config.width * 0.88)
            )
    else:
        hive_side = "left"
        hive_edge = int(config.width * 0.12)

    smooth = np.convolve(motion_hist, np.ones(31, dtype=np.float32) / 31.0, mode="same")
    peak_x = int(np.argmax(smooth))

    line_x, path_meta = flight_path_gate_from_profile(
        smooth,
        hive_edge,
        hive_side,
        config,
    )
    path_motion = path_meta.get("path_motion_score", 0.0)
    if line_x is None or path_motion < 250:
        return {
            **tuned_default,
            "auto_line_x": None,
            "auto_hive_x": None,
            "motion_peak_x": peak_x,
            "hive_side": hive_side,
            "hive_edge_x": hive_edge,
            **path_meta,
            "label": "Fallback tuned open-air gate",
        }

    open_sign = 1 if hive_side == "left" else -1
    min_line = hive_edge + (open_sign * path_meta.get("path_start_gap", 64))
    max_line = hive_edge + (open_sign * path_meta.get("path_end_gap", 180))
    if hive_side == "left":
        line_x = clamp_int(line_x, min_line, min(config.width - 30, max_line))
        hive_x = clamp_int(line_x - max(40, int(config.open_side_min_distance * 1.7)), 8, config.width - 1)
    else:
        line_x = clamp_int(line_x, max(30, max_line), min_line)
        hive_x = clamp_int(line_x + max(40, int(config.open_side_min_distance * 1.7)), 0, config.width - 8)

    return {
        "line_x1": line_x,
        "line_y1": 0,
        "line_x2": line_x,
        "line_y2": config.height - 1,
        "hive_x": hive_x,
        "hive_y": config.height // 2,
        "auto_line_x": line_x,
        "auto_hive_x": hive_x,
        "motion_peak_x": peak_x,
        "hive_side": hive_side,
        "hive_edge_x": hive_edge,
        **path_meta,
        "label": "Auto flight-path gate",
    }


def get_tuned_setup(filename):
    if not filename:
        return None
    return KNOWN_TUNED_SETUPS.get(os.path.basename(filename).lower())


def build_geometry(form, config):
    line_start = clamp_point(
        form.get("line_x1", form.get("line_x", 300)),
        form.get("line_y1", form.get("line_y", 0)),
        config,
    )
    line_end = clamp_point(
        form.get("line_x2", form.get("line_x", 300)),
        form.get("line_y2", form.get("line_y", config.height)),
        config,
    )
    hive_point = clamp_point(
        form.get("hive_x", 0),
        form.get("hive_y", 0),
        config,
    )

    line_dx = line_end[0] - line_start[0]
    line_dy = line_end[1] - line_start[1]
    line_length = float(np.hypot(line_dx, line_dy))
    if line_length < 10:
        raise ValueError("Counting line is too short")

    def signed_distance(px, py):
        numerator = ((px - line_start[0]) * line_dy) - ((py - line_start[1]) * line_dx)
        return numerator / line_length

    hive_side_sign = signed_distance(hive_point[0], hive_point[1])
    if abs(hive_side_sign) <= config.line_margin:
        raise ValueError("Hive-side point is too close to the line")

    return {
        "line_start": line_start,
        "line_end": line_end,
        "hive_point": hive_point,
        "signed_distance": signed_distance,
        "hive_side_sign": hive_side_sign,
        "line_unit": (line_dx / line_length, line_dy / line_length),
    }


def get_zone(value, margin):
    if value < -margin:
        return "left"
    if value > margin:
        return "right"
    return "center"


def detection_sort_key(det, geometry, config):
    open_side = (det["distance"] * geometry["hive_side_sign"]) < -config.line_margin
    in_count_band = abs(det["distance"]) <= config.max_count_distance
    spans_line = (
        det.get("min_distance", det["distance"]) < -config.line_margin
        and det.get("max_distance", det["distance"]) > config.line_margin
    )
    if spans_line:
        bucket = 0
    elif open_side and in_count_band:
        bucket = 1
    elif in_count_band:
        bucket = 2
    else:
        bucket = 3
    return (bucket, -det["area"], abs(det["distance"]))


def is_duplicate_detection(detections, candidate):
    cx, cy = candidate["center"]
    x1, y1, x2, y2 = candidate["bbox"]
    candidate_size = max(10, min(x2 - x1, y2 - y1))
    for detection in detections:
        dx = cx - detection["center"][0]
        dy = cy - detection["center"][1]
        if float(np.hypot(dx, dy)) <= candidate_size:
            return True
    return False


def build_detection(contour, geometry, config, source):
    area = cv2.contourArea(contour)
    moments = cv2.moments(contour)
    if moments["m00"] <= 0:
        return None

    cx = int(moments["m10"] / moments["m00"])
    cy = int(moments["m01"] / moments["m00"])
    x, y, w, h = cv2.boundingRect(contour)
    pad = 2
    center_distance = float(geometry["signed_distance"](cx, cy))
    contour_points = contour.reshape(-1, 2)
    contour_distances = [
        float(geometry["signed_distance"](int(px), int(py)))
        for px, py in contour_points
    ] or [center_distance]
    min_distance = min(contour_distances)
    max_distance = max(contour_distances)
    return {
        "bbox": (
            max(0, x - pad),
            max(0, y - pad),
            min(config.width - 1, x + w + pad),
            min(config.height - 1, y + h + pad),
        ),
        "center": (cx, cy),
        "area": int(area),
        "distance": center_distance,
        "min_distance": min_distance,
        "max_distance": max_distance,
        "line_span": max_distance - min_distance,
        "source": source,
    }


def detect_motion_boxes(mask, geometry, config, gray=None, include_dark_motion=True):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    detections = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < config.min_contour_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if area > config.max_contour_area:
            if w > config.max_large_motion_width or h > config.max_large_motion_height:
                continue

        detection = build_detection(contour, geometry, config, "motion")
        if detection is None:
            continue
        detections.append(detection)

    if gray is not None and include_dark_motion:
        _, dark_mask = cv2.threshold(gray, config.dark_threshold, 255, cv2.THRESH_BINARY_INV)
        dark_mask = cv2.bitwise_and(dark_mask, cv2.dilate(mask, None, iterations=1))
        dark_contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in dark_contours:
            area = cv2.contourArea(contour)
            if area < config.min_dark_motion_area or area > config.max_dark_motion_area:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w > config.max_dark_motion_width or h > config.max_dark_motion_height:
                continue

            detection = build_detection(contour, geometry, config, "dark-motion")
            if detection is None:
                continue
            if abs(detection["distance"]) > config.max_count_distance:
                continue
            if detection["distance"] * geometry["hive_side_sign"] >= -config.line_margin:
                continue
            if is_duplicate_detection(detections, detection):
                continue
            detections.append(detection)

    detections.sort(key=lambda det: detection_sort_key(det, geometry, config))
    return detections[:config.max_detections_per_frame]


def detection_close_to_line(detection, max_line_gap):
    min_distance = float(detection.get("min_distance", detection["distance"]))
    max_distance = float(detection.get("max_distance", detection["distance"]))
    if min_distance <= 0 <= max_distance:
        return True
    return min(
        abs(float(detection["distance"])),
        abs(min_distance),
        abs(max_distance),
    ) <= max_line_gap


def filter_live_gate_detections(detections, config):
    max_line_gap = max(42, min(96, int(config.width * 0.085)))
    filtered = []
    for detection in detections:
        if not detection_close_to_line(detection, max_line_gap):
            continue
        x1, y1, x2, y2 = detection["bbox"]
        box_w = x2 - x1
        box_h = y2 - y1
        if box_w > int(config.width * 0.42) or box_h > int(config.height * 0.42):
            continue
        filtered.append(detection)
    filtered.sort(key=lambda det: (abs(float(det["distance"])), -int(det["area"])))
    return filtered[:config.max_detections_per_frame]


def stabilize_previous_gray(prev_gray, gray):
    meta = {
        "enabled": True,
        "applied": False,
        "dx": 0.0,
        "dy": 0.0,
        "response": 0.0,
    }

    try:
        prev_f = prev_gray.astype(np.float32)
        gray_f = gray.astype(np.float32)
        shift, response = cv2.phaseCorrelate(prev_f, gray_f)
        dx, dy = float(shift[0]), float(shift[1])
        meta.update({
            "dx": round(dx, 2),
            "dy": round(dy, 2),
            "response": round(float(response), 4),
        })

        if response < 0.03 or abs(dx) > 40 or abs(dy) > 40:
            return prev_gray, meta

        matrix = np.float32([[1, 0, dx], [0, 1, dy]])
        aligned = cv2.warpAffine(
            prev_gray,
            matrix,
            (prev_gray.shape[1], prev_gray.shape[0]),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        meta["applied"] = True
        return aligned, meta
    except Exception:
        meta["enabled"] = False
        return prev_gray, meta


def apply_line_corridor(mask, geometry, config):
    corridor_width = max(28, min(72, int(config.width * 0.065)))
    corridor = np.zeros_like(mask)
    cv2.line(
        corridor,
        geometry["line_start"],
        geometry["line_end"],
        255,
        thickness=max(1, corridor_width * 2),
    )
    return cv2.bitwise_and(mask, corridor), corridor_width


def detection_reaches_opposite_side(from_side, detection, margin):
    if from_side == "left" and detection.get("max_distance", detection["distance"]) > margin:
        return "right"
    if from_side == "right" and detection.get("min_distance", detection["distance"]) < -margin:
        return "left"
    return None


def decode_uploaded_frame(upload):
    if upload is None:
        return None
    data = np.frombuffer(upload.read(), np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def build_live_diff(prev_frame, frame, config, geometry=None, stabilize=False):
    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (config.dilate_kernel, config.dilate_kernel))
    kernel_big = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (config.close_kernel, config.close_kernel))

    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    prev_gray = cv2.GaussianBlur(prev_gray, (config.blur_kernel, config.blur_kernel), 0)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (config.blur_kernel, config.blur_kernel), 0)

    if stabilize:
        prev_gray, stabilization = stabilize_previous_gray(prev_gray, gray)
    else:
        stabilization = {
            "enabled": False,
            "applied": False,
            "dx": 0.0,
            "dy": 0.0,
            "response": 0.0,
        }
    diff = cv2.absdiff(prev_gray, gray)
    _, diff = cv2.threshold(diff, config.diff_threshold, 255, cv2.THRESH_BINARY)
    diff = cv2.morphologyEx(diff, cv2.MORPH_CLOSE, kernel_big)
    diff = cv2.dilate(diff, kernel_small, iterations=config.dilate_iterations)
    corridor_width = None
    if geometry is not None:
        diff, corridor_width = apply_line_corridor(diff, geometry, config)
    return diff, gray, {
        "stabilization": stabilization,
        "line_corridor_width": corridor_width,
    }


def build_baseline_foreground(baseline_frame, frame, config, geometry):
    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    kernel_big = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    baseline_gray = cv2.cvtColor(baseline_frame, cv2.COLOR_BGR2GRAY)
    baseline_gray = cv2.GaussianBlur(baseline_gray, (5, 5), 0)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    diff = cv2.absdiff(baseline_gray, gray)
    threshold = max(22, min(42, config.diff_threshold + 10))
    _, mask = cv2.threshold(diff, threshold, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel_small)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_big)
    mask = cv2.dilate(mask, kernel_small, iterations=1)
    mask, corridor_width = apply_line_corridor(mask, geometry, config)

    return mask, gray, {
        "enabled": True,
        "threshold": int(threshold),
        "line_corridor_width": corridor_width,
    }


def serialize_detection(detection, config):
    return {
        "bbox": [int(value) for value in detection["bbox"]],
        "center": [int(value) for value in detection["center"]],
        "area": int(detection["area"]),
        "distance": round(float(detection["distance"]), 2),
        "zone": get_zone(float(detection["distance"]), config.line_margin),
        "source": detection["source"],
        "yolo_verified": bool(detection.get("yolo_verified", False)),
    }


def serialize_yolo_detection(detection):
    return {
        "bbox": [int(value) for value in detection["bbox"]],
        "confidence": detection["confidence"],
    }


def boxes_overlap_ratio(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    intersection = iw * ih
    if intersection <= 0:
        return 0.0
    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    return intersection / float(min(area_a, area_b))


def detection_matches_yolo(detection, yolo_detections, max_center_distance=80):
    cx, cy = detection["center"]
    for yolo_det in yolo_detections:
        x1, y1, x2, y2 = yolo_det["bbox"]
        ycx = (x1 + x2) / 2.0
        ycy = (y1 + y2) / 2.0
        if boxes_overlap_ratio(detection["bbox"], yolo_det["bbox"]) >= 0.15:
            return True
        if float(np.hypot(cx - ycx, cy - ycy)) <= max_center_distance:
            return True
    return False


def run_yolo_verification(model, frame, conf=0.15):
    if model is None:
        return []
    results = model(frame, conf=conf, verbose=False, imgsz=960, device=YOLO_DEVICE)
    boxes_obj = results[0].boxes
    if boxes_obj is None or len(boxes_obj) == 0:
        return []

    boxes = boxes_obj.xyxy.cpu().numpy()
    confs = boxes_obj.conf.cpu().numpy()
    detections = []
    for box, confidence in zip(boxes, confs):
        x1, y1, x2, y2 = map(int, box)
        detections.append({
            "bbox": (
                max(0, x1),
                max(0, y1),
                min(frame.shape[1] - 1, x2),
                min(frame.shape[0] - 1, y2),
            ),
            "confidence": round(float(confidence), 3),
        })
    return detections


def is_crossing_match(track, detection, margin):
    previous_distance = float(track.get("distance", track.get("previous_distance", detection["distance"])))
    previous_side = get_zone(previous_distance, margin)
    if previous_side not in ("left", "right"):
        previous_side = track.get("confirmed_side") or track.get("last_side")
    return detection_reaches_opposite_side(previous_side, detection, margin) is not None


def make_track(detection, frame_count, config):
    initial_side = get_zone(detection["distance"], config.line_margin)
    if initial_side not in ("left", "right"):
        initial_side = None
    return {
        "center": detection["center"],
        "previous_center": detection["center"],
        "last_seen": frame_count,
        "age": 1,
        "last_side": None,
        "side_streak": 0,
        "confirmed_side": None,
        "center_streak": 0,
        "armed": True,
        "armed_side": initial_side,
        "last_counted": -config.cooldown_frames,
        "last_center": detection["center"],
        "distance": detection["distance"],
        "previous_distance": detection["distance"],
        "min_distance": detection.get("min_distance", detection["distance"]),
        "max_distance": detection.get("max_distance", detection["distance"]),
        "perpendicular_motion": 0.0,
        "parallel_motion": 0.0,
        "last_perpendicular_step": 0.0,
        "last_parallel_step": 0.0,
        "velocity": (0.0, 0.0),
        "bbox": detection["bbox"],
        "area": detection["area"],
        "matched_by_crossing": False,
    }


def assign_tracks(tracks, detections, frame_count, geometry, config):
    stale_ids = [
        track_id for track_id, track in tracks.items()
        if frame_count - track["last_seen"] > config.stale_frames
    ]
    for track_id in stale_ids:
        tracks.pop(track_id, None)

    line_ux, line_uy = geometry["line_unit"]
    candidates = []

    for det_index, detection in enumerate(detections):
        cx, cy = detection["center"]
        for track_id, track in tracks.items():
            frames_missing = frame_count - track["last_seen"]
            if frames_missing <= 0 or frames_missing > config.stale_frames:
                continue

            px, py = track["center"]
            vx, vy = track.get("velocity", (0.0, 0.0))
            predicted_x = px + (vx * frames_missing)
            predicted_y = py + (vy * frames_missing)
            raw_distance = float(np.hypot(cx - px, cy - py))
            predicted_distance = float(np.hypot(cx - predicted_x, cy - predicted_y))
            match_distance = min(raw_distance, predicted_distance)
            speed = float(np.hypot(vx, vy))
            missing_bonus = min(max(frames_missing - 1, 0), 3) * (config.max_track_distance * 0.5)
            allowed_distance = max(
                config.max_track_distance + missing_bonus,
                min(config.fast_track_distance, (speed * frames_missing) + config.max_track_distance),
            )

            crossing_match = is_crossing_match(track, detection, config.line_margin)
            in_count_cooldown = frame_count - track.get("last_counted", -config.cooldown_frames) <= config.cooldown_frames
            if crossing_match and (not track.get("armed", True) or in_count_cooldown):
                crossing_match = False
            if crossing_match:
                if (
                    abs(track.get("distance", detection["distance"])) > config.max_count_distance
                    or abs(detection["distance"]) > config.max_count_distance
                ):
                    continue
                parallel_jump = abs((cx - px) * line_ux + (cy - py) * line_uy)
                if parallel_jump > config.max_parallel_jump and raw_distance > config.max_track_distance:
                    continue
                allowed_distance = max(allowed_distance, config.fast_track_distance)

            if match_distance > allowed_distance:
                continue

            previous_area = max(1, int(track.get("area", detection["area"])))
            current_area = max(1, int(detection["area"]))
            area_delta = abs(current_area - previous_area) / max(previous_area, current_area)
            score = match_distance + (frames_missing * 8.0) + (area_delta * 20.0)
            if crossing_match:
                score -= max(30.0, config.fast_track_distance * 0.55)
            candidates.append((score, track_id, det_index, frames_missing, crossing_match))

    candidates.sort(key=lambda item: item[0])
    assigned_tracks = set()
    assigned_detections = {}

    for _, track_id, det_index, frames_missing, crossing_match in candidates:
        if track_id in assigned_tracks or det_index in assigned_detections:
            continue

        detection = detections[det_index]
        track = tracks[track_id]
        px, py = track["center"]
        cx, cy = detection["center"]
        elapsed = max(1, frames_missing)
        track["previous_center"] = track["center"]
        track["previous_distance"] = track.get("distance", detection["distance"])
        track["center"] = detection["center"]
        track["distance"] = detection["distance"]
        track["last_seen"] = frame_count
        track["age"] += 1
        track["velocity"] = ((cx - px) / elapsed, (cy - py) / elapsed)
        track["bbox"] = detection["bbox"]
        track["area"] = detection["area"]
        track["matched_by_crossing"] = crossing_match

        assigned_tracks.add(track_id)
        assigned_detections[det_index] = track_id

    ghost_detections = set()
    for track_id in assigned_tracks:
        track = tracks[track_id]
        if not track.get("matched_by_crossing", False):
            continue
        old_x, old_y = track.get("previous_center", track["center"])
        for det_index, detection in enumerate(detections):
            if det_index in assigned_detections:
                continue
            cx, cy = detection["center"]
            if float(np.hypot(cx - old_x, cy - old_y)) <= max(12, config.max_track_distance):
                ghost_detections.add(det_index)

    for det_index, detection in enumerate(detections):
        if det_index in assigned_detections:
            continue
        if det_index in ghost_detections:
            continue
        track_id = max(tracks.keys(), default=0) + 1
        tracks[track_id] = make_track(detection, frame_count, config)
        assigned_detections[det_index] = track_id

    return [
        (assigned_detections[det_index], detections[det_index])
        for det_index in range(len(detections))
        if det_index in assigned_detections
    ]


def process_count_video(input_path, output_path, geometry, config, debug_mode, trial_mode="motion"):
    cap = cv2.VideoCapture(input_path)
    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
    out_video = cv2.VideoWriter(
        output_path,
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (config.width, config.height),
    )

    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (config.dilate_kernel, config.dilate_kernel))
    kernel_big = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (config.close_kernel, config.close_kernel))

    tracks = {}
    total_in = 0
    total_out = 0
    detection_frames = 0
    no_detection_frames = 0
    max_detections_in_frame = 0
    total_detections = 0
    total_motion_pixels = 0
    max_motion_pixels = 0
    recent_motion_pixels = []
    counted_events = []
    flash_events = []
    recent_crossings = []
    hybrid_enabled = trial_mode == "hybrid"
    hybrid_model = None
    hybrid_error = None
    hybrid_frame_stride = 5
    yolo_frames_checked = 0
    yolo_detection_frames = 0
    yolo_total_detections = 0
    yolo_motion_matches = 0
    yolo_recent_detections = []
    yolo_verified_events = 0
    yolo_unverified_events = 0
    if hybrid_enabled:
        try:
            hybrid_model = get_hybrid_model()
        except Exception as exc:
            hybrid_error = str(exc)
            hybrid_enabled = False
    frame_count = 0
    prev_gray = None
    prev2_gray = None
    line_ux, line_uy = geometry["line_unit"]
    line_nx, line_ny = -line_uy, line_ux
    signed_nx, signed_ny = line_uy, -line_ux

    def is_recent_duplicate_crossing(detection, from_side, to_side):
        cx, cy = detection["center"]
        for event in recent_crossings:
            if event["from"] != from_side or event["to"] != to_side:
                continue
            if frame_count - event["frame"] > config.cooldown_frames:
                continue
            ex, ey = event["center"]
            perpendicular_gap = abs((cx - ex) * line_nx + (cy - ey) * line_ny)
            parallel_gap = abs((cx - ex) * line_ux + (cy - ey) * line_uy)
            if (
                perpendicular_gap <= max(24, config.max_track_distance)
                and parallel_gap <= max(config.max_parallel_jump, config.max_track_distance * 3)
            ):
                return True
        return False

    def progress_on_side(track, detection, side):
        detection_min = detection.get("min_distance", detection["distance"])
        detection_max = detection.get("max_distance", detection["distance"])
        if side == "right":
            return max(track["max_distance"], detection_max)
        return max(-track["min_distance"], -detection_min)

    def label_for_to_side(to_side):
        current_sign = -1 if to_side == "left" else 1
        going_in = (current_sign * geometry["hive_side_sign"]) > 0
        return "IN" if going_in else "OUT"

    def add_total(label, amount):
        nonlocal total_in, total_out
        if label == "IN":
            total_in += amount
        else:
            total_out += amount

    def in_count_band(track, detection):
        previous_distance = track.get("previous_distance", track.get("distance", detection["distance"]))
        return (
            abs(previous_distance) <= config.max_count_distance
            and abs(detection["distance"]) <= config.max_count_distance
        )

    def opposite_side(side):
        return "left" if side == "right" else "right"

    def detection_line_gap(detection):
        detection_min = detection.get("min_distance", detection["distance"])
        detection_max = detection.get("max_distance", detection["distance"])
        if detection_min <= 0 <= detection_max:
            return 0.0
        return min(abs(detection_min), abs(detection_max), abs(detection["distance"]))

    def countable_detection_position(detection):
        x1, y1, x2, y2 = detection["bbox"]
        border_margin = max(8, config.line_margin * 2)
        if (
            x1 <= border_margin
            or y1 <= border_margin
            or x2 >= config.width - border_margin
            or y2 >= config.height - border_margin
        ):
            return False

        max_line_gap = max(180, config.open_side_min_distance * 5)
        return detection_line_gap(detection) <= max_line_gap

    def estimate_image_motion_delta(detection, motion_mask):
        x1, y1, x2, y2 = detection["bbox"]
        expand = max(8, min(90, config.fast_track_distance // 2))
        x1 = max(0, x1 - expand)
        y1 = max(0, y1 - expand)
        x2 = min(config.width - 1, x2 + expand)
        y2 = min(config.height - 1, y2 + expand)

        mask_crop = motion_mask[y1:y2 + 1, x1:x2 + 1] > 0
        if int(np.count_nonzero(mask_crop)) < config.min_dark_motion_area:
            return None

        current_crop = gray[y1:y2 + 1, x1:x2 + 1]
        previous_crop = prev_gray[y1:y2 + 1, x1:x2 + 1]

        def weighted_distance(image_crop):
            darkness_ceiling = max(config.dark_threshold + 85, 205)
            weights = np.where(
                mask_crop,
                np.clip(darkness_ceiling - image_crop.astype(np.float32), 0, None),
                0,
            )
            weights = weights * weights
            total = float(weights.sum())
            if total < config.min_dark_motion_area * 25:
                return None
            ys, xs = np.indices(weights.shape)
            cx = float((xs * weights).sum() / total) + x1
            cy = float((ys * weights).sum() / total) + y1
            return float(geometry["signed_distance"](cx, cy))

        current_dark_distance = weighted_distance(current_crop)
        previous_dark_distance = weighted_distance(previous_crop)
        if current_dark_distance is None or previous_dark_distance is None:
            return None
        return current_dark_distance - previous_dark_distance

    def find_recent_crossing_group(detection):
        cx, cy = detection["center"]
        merge_window = max(config.cooldown_frames * 2, 10)
        for event in reversed(recent_crossings):
            if frame_count - event["frame"] > merge_window:
                continue
            if frame_count - event["frame"] <= 3:
                return event
            ex, ey = event["center"]
            perpendicular_gap = abs((cx - ex) * line_nx + (cy - ey) * line_ny)
            parallel_gap = abs((cx - ex) * line_ux + (cy - ey) * line_uy)
            if (
                perpendicular_gap <= max(32, config.max_track_distance)
                and parallel_gap <= max(config.max_parallel_jump, config.max_track_distance * 3)
            ):
                return event
        return None

    open_side = "left" if geometry["hive_side_sign"] > 0 else "right"

    def record_count(track_id, track, detection, from_side, to_side, reason, direction_source, direction_delta):
        nonlocal total_in, total_out, counted_events, flash_events, recent_crossings
        nonlocal yolo_verified_events, yolo_unverified_events

        yolo_verified = detection_matches_yolo(detection, yolo_recent_detections)
        if yolo_verified:
            yolo_verified_events += 1
        else:
            yolo_unverified_events += 1
        direction_value = direction_delta
        if direction_value is None or abs(direction_value) < config.min_crossing_distance:
            direction_value = config.min_crossing_distance if to_side == "right" else -config.min_crossing_distance
        if direction_source == "image-motion" and direction_delta is not None:
            to_side = "right" if direction_delta > 0 else "left"
            from_side = opposite_side(to_side)
            evidence = max(
                abs(direction_delta),
                detection.get("line_span", 0.0),
                config.min_crossing_distance,
            )
            direction_value = evidence * (1 if direction_delta > 0 else -1) * 3.0
        group = find_recent_crossing_group(detection)
        if group is not None and 0 <= group["event_index"] < len(counted_events):
            event = counted_events[group["event_index"]]
            old_label = event["label"]
            add_total(old_label, -1)

            group["direction_sum"] += direction_value
            merged_to_side = "right" if group["direction_sum"] > 0 else "left"
            merged_from_side = opposite_side(merged_to_side)
            merged_label = label_for_to_side(merged_to_side)
            add_total(merged_label, 1)

            event["label"] = merged_label
            event["from"] = merged_from_side
            event["to"] = merged_to_side
            event["center"] = detection["center"]
            event["bbox"] = detection["bbox"]
            event["reason"] = "merged-crossing"
            event["source"] = f"{event.get('source', 'motion')}+{detection.get('source', 'motion')}"
            event["direction_source"] = f"{event.get('direction_source', 'track-motion')}+{direction_source}"
            event["direction_delta"] = round(group["direction_sum"], 1)
            event["yolo_verified"] = event.get("yolo_verified", False) or yolo_verified
            event["merged_frames"] = [*event.get("merged_frames", [event["frame"]]), frame_count]
            group["frame"] = frame_count
            group["center"] = detection["center"]
            track["last_counted"] = frame_count
            track["armed"] = False
            track["armed_side"] = merged_to_side
            track["confirmed_side"] = merged_to_side
            track["last_side"] = merged_to_side
            track["min_distance"] = detection["distance"]
            track["max_distance"] = detection["distance"]
            track["perpendicular_motion"] = 0.0
            track["parallel_motion"] = 0.0
            track["last_perpendicular_step"] = 0.0
            track["last_parallel_step"] = 0.0
            return

        label = label_for_to_side(to_side)
        add_total(label, 1)
        distance_span = track["max_distance"] - track["min_distance"]
        track["last_counted"] = frame_count
        track["armed"] = False
        track["armed_side"] = to_side
        track["confirmed_side"] = to_side
        track["last_side"] = to_side
        counted_events.append({
            "frame": frame_count,
            "track_id": track_id,
            "label": label,
            "from": from_side,
            "to": to_side,
            "center": detection["center"],
            "bbox": detection["bbox"],
            "reason": reason,
            "source": detection.get("source", "motion"),
            "direction_source": direction_source,
            "direction_delta": round(direction_delta, 1) if direction_delta is not None else None,
            "yolo_verified": yolo_verified,
            "distance_span": round(distance_span, 1),
            "perpendicular_motion": round(track["perpendicular_motion"], 1),
            "parallel_motion": round(track["parallel_motion"], 1),
        })
        counted_events = counted_events[-20:]
        flash_events.append({
            "end": frame_count + 12,
            "label": label,
            "cx": detection["center"][0],
            "cy": detection["center"][1],
        })
        recent_crossings.append({
            "frame": frame_count,
            "from": from_side,
            "to": to_side,
            "center": detection["center"],
            "event_index": len(counted_events) - 1,
            "direction_sum": direction_value,
        })
        recent_crossings = recent_crossings[-20:]
        track["min_distance"] = detection["distance"]
        track["max_distance"] = detection["distance"]
        track["perpendicular_motion"] = 0.0
        track["parallel_motion"] = 0.0
        track["last_perpendicular_step"] = 0.0
        track["last_parallel_step"] = 0.0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.resize(frame, (config.width, config.height))
        frame_count += 1
        current_yolo_detections = []
        if hybrid_enabled and frame_count % hybrid_frame_stride == 0:
            current_yolo_detections = run_yolo_verification(hybrid_model, frame)
            yolo_recent_detections = current_yolo_detections
            yolo_frames_checked += 1
            yolo_total_detections += len(current_yolo_detections)
            if current_yolo_detections:
                yolo_detection_frames += 1
        flash_events = [event for event in flash_events if event["end"] > frame_count]
        recent_crossings = [
            event for event in recent_crossings
            if frame_count - event["frame"] <= config.cooldown_frames
        ]

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (config.blur_kernel, config.blur_kernel), 0)

        if prev_gray is None:
            prev_gray = gray
            out_video.write(frame)
            continue

        diff = cv2.absdiff(prev_gray, gray)
        if prev2_gray is not None:
            diff = cv2.max(diff, cv2.absdiff(prev2_gray, gray))
        _, diff = cv2.threshold(diff, config.diff_threshold, 255, cv2.THRESH_BINARY)
        diff = cv2.morphologyEx(diff, cv2.MORPH_CLOSE, kernel_big)
        diff = cv2.dilate(diff, kernel_small, iterations=config.dilate_iterations)

        motion_pixels = int(cv2.countNonZero(diff))
        total_motion_pixels += motion_pixels
        max_motion_pixels = max(max_motion_pixels, motion_pixels)
        recent_motion_pixels.append(motion_pixels)
        recent_motion_pixels = recent_motion_pixels[-20:]

        detections = detect_motion_boxes(diff, geometry, config, gray)
        detection_count = len(detections)
        if yolo_recent_detections:
            yolo_motion_matches += sum(
                1 for detection in detections
                if detection_matches_yolo(detection, yolo_recent_detections)
            )
        total_detections += detection_count
        max_detections_in_frame = max(max_detections_in_frame, detection_count)
        if detection_count > 0:
            detection_frames += 1
        else:
            no_detection_frames += 1

        assignments = assign_tracks(tracks, detections, frame_count, geometry, config)

        for track_id, detection in assignments:
            track = tracks[track_id]
            current_distance = detection["distance"]
            current_side = get_zone(current_distance, config.line_margin)
            previous_confirmed_side = track.get("confirmed_side")
            previous_distance = track.get("previous_distance", current_distance)
            previous_motion_side = get_zone(previous_distance, config.line_margin)
            armed_side = track.get("armed_side") if track.get("armed") else None
            crossing_from_side = armed_side if armed_side in ("left", "right") else previous_motion_side
            if crossing_from_side not in ("left", "right"):
                crossing_from_side = previous_confirmed_side
            if crossing_from_side not in ("left", "right"):
                crossing_from_side = track.get("last_side")
            image_motion_delta = estimate_image_motion_delta(detection, diff)
            track_motion_delta = current_distance - previous_distance
            direction_delta = image_motion_delta
            direction_source = "image-motion"
            if direction_delta is None or abs(direction_delta) < config.min_crossing_distance:
                direction_delta = track_motion_delta
                direction_source = "track-motion"
            movement_to_side = None
            if abs(direction_delta) >= config.min_crossing_distance:
                movement_to_side = "right" if direction_delta > 0 else "left"

            previous_center = track.get("last_center")
            if previous_center is not None:
                dx = detection["center"][0] - previous_center[0]
                dy = detection["center"][1] - previous_center[1]
                track["last_perpendicular_step"] = abs(dx * line_nx + dy * line_ny)
                track["last_parallel_step"] = abs(dx * line_ux + dy * line_uy)
                track["perpendicular_motion"] += track["last_perpendicular_step"]
                track["parallel_motion"] += track["last_parallel_step"]
            else:
                track["last_perpendicular_step"] = 0.0
                track["last_parallel_step"] = 0.0
            track["last_center"] = detection["center"]
            detection_min_distance = detection.get("min_distance", current_distance)
            detection_max_distance = detection.get("max_distance", current_distance)
            track["min_distance"] = min(track["min_distance"], current_distance, detection_min_distance)
            track["max_distance"] = max(track["max_distance"], current_distance, detection_max_distance)
            track["perpendicular_motion"] = max(
                track["perpendicular_motion"],
                detection.get("line_span", detection_max_distance - detection_min_distance),
            )

            if current_side != "center":
                if current_side == track["last_side"]:
                    track["side_streak"] += 1
                else:
                    track["side_streak"] = 1

                if track["side_streak"] >= config.side_confirm_frames:
                    track["confirmed_side"] = current_side
                if track.get("armed") and track.get("armed_side") not in ("left", "right"):
                    track["armed_side"] = current_side

            confirmed_side = track["confirmed_side"]
            crossed_to_side = None
            if crossing_from_side in ("left", "right"):
                if confirmed_side in ("left", "right") and confirmed_side != crossing_from_side:
                    crossed_to_side = confirmed_side
                else:
                    crossed_to_side = detection_reaches_opposite_side(
                        crossing_from_side, detection, config.line_margin
                    )
            spans_line = (
                detection_min_distance < -config.line_margin
                and detection_max_distance > config.line_margin
            )
            movement_crosses_line = (
                movement_to_side in ("left", "right")
                and crossing_from_side in ("left", "right")
                and movement_to_side != crossing_from_side
                and (
                    crossed_to_side in ("left", "right")
                    or spans_line
                    or (
                        previous_motion_side in ("left", "right")
                        and current_side in ("left", "right")
                        and previous_motion_side != current_side
                    )
                    or detection_reaches_opposite_side(crossing_from_side, detection, config.line_margin) == movement_to_side
                )
            )
            if movement_crosses_line:
                crossed_to_side = movement_to_side
            elif (
                direction_source == "image-motion"
                and movement_to_side in ("left", "right")
                and abs(direction_delta) >= config.min_crossing_distance
                and (
                    spans_line
                    or detection.get("line_span", 0.0) >= config.open_side_min_distance
                )
            ):
                crossing_from_side = opposite_side(movement_to_side)
                crossed_to_side = movement_to_side

            distance_span = track["max_distance"] - track["min_distance"]
            has_direct_crossing = crossed_to_side in ("left", "right")
            fast_image_crossing = (
                direction_source == "image-motion"
                and movement_to_side in ("left", "right")
                and crossed_to_side == movement_to_side
                and detection.get("source") == "dark-motion"
                and detection.get("line_span", 0.0) >= config.min_perpendicular_motion
                and detection_line_gap(detection) <= max(
                    config.max_track_distance,
                    config.open_side_min_distance * 3,
                )
            )
            perpendicular_dominates_parallel = (
                track["perpendicular_motion"] >= (
                    track["parallel_motion"] * config.perpendicular_ratio
                )
            )
            recent_perpendicular_ok = (
                fast_image_crossing
                or (
                    track.get("last_perpendicular_step", 0.0) >= config.min_perpendicular_motion
                    and track.get("last_perpendicular_step", 0.0) >= (
                        track.get("last_parallel_step", 0.0) * 0.85
                    )
                )
                or (
                    perpendicular_dominates_parallel
                    and track["perpendicular_motion"] >= config.min_perpendicular_motion * 1.5
                )
            )
            perpendicular_ok = (
                track["perpendicular_motion"] >= config.min_perpendicular_motion
                and recent_perpendicular_ok
                and perpendicular_dominates_parallel
            )
            can_count = (
                crossing_from_side in ("left", "right")
                and has_direct_crossing
                and crossing_from_side != crossed_to_side
                and progress_on_side(track, detection, open_side) >= config.open_side_min_distance
                and in_count_band(track, detection)
                and (track["age"] >= config.min_track_age or fast_image_crossing)
                and track["armed"]
                and frame_count - track["last_counted"] > config.cooldown_frames
                and distance_span >= config.min_crossing_distance
                and perpendicular_ok
                and countable_detection_position(detection)
                and not is_recent_duplicate_crossing(detection, crossing_from_side, crossed_to_side)
            )

            if can_count:
                reason = "fast-crossing" if current_side == "center" or track.get("matched_by_crossing") else "line-crossing"
                record_count(
                    track_id,
                    track,
                    detection,
                    crossing_from_side,
                    crossed_to_side,
                    reason,
                    direction_source,
                    direction_delta,
                )
            else:
                if current_side == "center":
                    track["center_streak"] += 1
                    track["side_streak"] = 0
                    track["last_side"] = current_side
                    if (
                        track["center_streak"] >= config.rearm_center_frames
                        and progress_on_side(track, detection, open_side) >= config.open_side_min_distance
                        and frame_count - track["last_counted"] > config.cooldown_frames
                    ):
                        track["armed"] = True
                        track["armed_side"] = track.get("confirmed_side")
                        track["min_distance"] = detection_min_distance
                        track["max_distance"] = detection_max_distance
                        track["perpendicular_motion"] = 0.0
                        track["parallel_motion"] = 0.0
                        track["last_perpendicular_step"] = 0.0
                        track["last_parallel_step"] = 0.0
                else:
                    track["center_streak"] = 0
                    track["last_side"] = current_side
                    if (
                        not track["armed"]
                        and abs(current_distance) >= config.rearm_side_distance
                        and frame_count - track["last_counted"] > config.cooldown_frames
                    ):
                        track["armed"] = True
                        track["armed_side"] = current_side
                        track["min_distance"] = detection_min_distance
                        track["max_distance"] = detection_max_distance
                        track["perpendicular_motion"] = 0.0
                        track["parallel_motion"] = 0.0
                        track["last_perpendicular_step"] = 0.0
                        track["last_parallel_step"] = 0.0

            x1, y1, x2, y2 = detection["bbox"]
            cx, cy = detection["center"]
            color = (0, 220, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.circle(frame, (cx, cy), 2, color, -1)
            cv2.putText(
                frame,
                f"T{track_id} {current_side[0].upper()} D{int(abs(current_distance))} A{detection['area']}",
                (x1, max(18, y1 - 5)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.4,
                color,
                1,
            )

        if hybrid_enabled and debug_mode:
            for yolo_det in current_yolo_detections:
                x1, y1, x2, y2 = yolo_det["bbox"]
                cv2.rectangle(frame, (x1, y1), (x2, y2), (180, 80, 255), 2)
                cv2.putText(
                    frame,
                    f"Y {yolo_det['confidence']:.2f}",
                    (x1, max(18, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    (180, 80, 255),
                    1,
                )

        cv2.line(frame, geometry["line_start"], geometry["line_end"], (180, 180, 180), 2)
        if debug_mode:
            open_sign = 1 if open_side == "right" else -1
            offset_x = int(round(signed_nx * open_sign * config.open_side_min_distance))
            offset_y = int(round(signed_ny * open_sign * config.open_side_min_distance))
            commit_start = (
                max(0, min(config.width - 1, geometry["line_start"][0] + offset_x)),
                max(0, min(config.height - 1, geometry["line_start"][1] + offset_y)),
            )
            commit_end = (
                max(0, min(config.width - 1, geometry["line_end"][0] + offset_x)),
                max(0, min(config.height - 1, geometry["line_end"][1] + offset_y)),
            )
            cv2.line(frame, commit_start, commit_end, (255, 120, 40), 1)
        cv2.circle(frame, geometry["hive_point"], 6, (82, 196, 138), -1)
        cv2.putText(
            frame,
            "Hive side",
            (geometry["hive_point"][0] + 8, max(18, geometry["hive_point"][1] - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (82, 196, 138),
            1,
        )

        for event in flash_events:
            label_color = (0, 255, 80) if event["label"] == "IN" else (60, 60, 255)
            label_y = max(40, event["cy"] - 10)
            label_x = min(config.width - 150, max(12, geometry["line_start"][0] + 8))
            cv2.putText(frame, f"+1 {event['label']}", (label_x, label_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 3)
            cv2.putText(frame, f"+1 {event['label']}", (label_x, label_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, label_color, 2)

        if debug_mode:
            mask_preview = cv2.cvtColor(diff, cv2.COLOR_GRAY2BGR)
            preview_h = min(config.preview_height, mask_preview.shape[0])
            preview_w = min(config.preview_width, mask_preview.shape[1])
            mask_preview = cv2.resize(mask_preview, (preview_w, preview_h))
            frame[config.height - preview_h - 16:config.height - 16, 16:16 + preview_w] = mask_preview
            cv2.putText(frame, "Frame diff mask", (16, config.height - preview_h - 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        panel = frame.copy()
        cv2.rectangle(panel, (20, 15), (300, 170), (0, 0, 0), -1)
        cv2.addWeighted(panel, 0.5, frame, 0.5, 0, frame)
        cv2.putText(frame, f"IN:  {total_in}", (30, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 80), 2)
        cv2.putText(frame, f"OUT: {total_out}", (30, 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (60, 60, 255), 2)
        cv2.putText(frame, f"Detections: {detection_count}", (30, 115),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 255), 2)
        cv2.putText(frame, f"Motion pixels: {motion_pixels}", (30, 140),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 220, 120), 2)
        cv2.putText(frame, f"Track dist: {config.max_track_distance}px", (30, 164),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 2)

        out_video.write(frame)
        prev2_gray = prev_gray
        prev_gray = gray

    cap.release()
    out_video.release()
    analysed_frames = max(0, frame_count - 1)
    detection_rate = round((detection_frames / analysed_frames) * 100, 1) if analysed_frames else 0.0
    avg_motion_pixels = round(total_motion_pixels / analysed_frames, 1) if analysed_frames else 0.0
    avg_detections = round(total_detections / analysed_frames, 2) if analysed_frames else 0.0
    total_events = total_in + total_out
    yolo_detection_rate = round((yolo_detection_frames / yolo_frames_checked) * 100, 1) if yolo_frames_checked else 0.0
    yolo_avg_detections = round(yolo_total_detections / yolo_frames_checked, 2) if yolo_frames_checked else 0.0
    yolo_match_rate = round((yolo_motion_matches / total_detections) * 100, 1) if total_detections else 0.0
    if total_events == 0 and detection_frames > 0:
        trial_verdict = "Motion is visible, but no line crossings were counted. Review the line placement and hive-side marker."
    elif total_events == 0:
        trial_verdict = "Little useful motion was found. Use a clearer, steadier entrance video."
    elif max_detections_in_frame > 20:
        trial_verdict = "Counting worked, but the scene is noisy. Tighten the camera framing or increase filtering before live use."
    else:
        trial_verdict = "Motion counting produced reviewable crossings. Compare the annotated video against manual counts."

    return {
        "total_in": total_in,
        "total_out": total_out,
        "total_frames": frame_count,
        "trial_report": {
            "purpose": "Validate motion-based traffic analysis before live phone tracking.",
            "verdict": trial_verdict,
            "analysed_frames": analysed_frames,
            "detection_rate": detection_rate,
            "avg_motion_pixels": avg_motion_pixels,
            "max_motion_pixels": max_motion_pixels,
            "avg_detections_per_frame": avg_detections,
            "max_detections_in_frame": max_detections_in_frame,
            "counted_events": total_events,
            "mode": trial_mode,
            "hybrid": {
                "enabled": trial_mode == "hybrid",
                "available": hybrid_error is None,
                "error": hybrid_error,
                "model": COUNT_MODEL_PATH,
                "frames_checked": yolo_frames_checked,
                "detection_frames": yolo_detection_frames,
                "detection_rate": yolo_detection_rate,
                "total_detections": yolo_total_detections,
                "avg_detections_per_checked_frame": yolo_avg_detections,
                "motion_matches": yolo_motion_matches,
                "motion_match_rate": yolo_match_rate,
                "yolo_verified_events": yolo_verified_events,
                "yolo_unverified_events": yolo_unverified_events,
                "interpretation": (
                    "YOLO confirms some motion evidence; unverified motion may still include fast blurred bees."
                    if trial_mode == "hybrid" and yolo_total_detections > 0
                    else "YOLO did not add confirmation in sampled frames; motion-only evidence is the main signal."
                ),
            },
            "review_steps": [
                "Watch the annotated video around each +1 event.",
                "Check whether fast blur trails near the line are boxed.",
                "In hybrid mode, purple Y boxes are YOLO confirmations; cyan T boxes are motion tracks.",
                "Compare IN and OUT totals with a short manual count.",
                "If boxes appear on background noise, use a steadier recording or tighter entrance framing.",
            ],
        },
        "debug": {
            "enabled": debug_mode,
            "detection_frames": detection_frames,
            "no_detection_frames": no_detection_frames,
            "max_detections_in_frame": max_detections_in_frame,
            "total_detections": total_detections,
            "avg_detections_per_frame": avg_detections,
            "avg_motion_pixels": avg_motion_pixels,
            "max_motion_pixels": max_motion_pixels,
            "hybrid_mode": trial_mode == "hybrid",
            "yolo_frames_checked": yolo_frames_checked,
            "yolo_total_detections": yolo_total_detections,
            "yolo_motion_matches": yolo_motion_matches,
            "recent_motion_pixels": recent_motion_pixels,
            "counted_events": counted_events,
            "mode": "frame-diff-line-crossing",
            "use_roi": False,
            "parameters": asdict(config),
        },
    }


@app.route("/")
def root():
    return jsonify({
        "name": "bee-motion-counter",
        "message": "Use /api/get-first-frame and /api/count-video to run whole-frame motion differencing with line crossing counts.",
        "default_parameters": asdict(DEFAULT_CONFIG),
    })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "online",
        "service": "motion-backend",
        "port": int(os.environ.get("PORT", 5001)),
        "mode": "motion-difference",
    })


@app.route("/api/get-first-frame", methods=["POST"])
def get_first_frame():
    if "video" not in request.files:
        return jsonify({"error": "No video uploaded"}), 400

    config = build_runtime_config(request.form)
    file = request.files["video"]
    tuned_setup = get_tuned_setup(file.filename)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        suggested_setup = suggest_motion_setup(tmp_path, config)
        cap = cv2.VideoCapture(tmp_path)
        ret, frame = cap.read()
        cap.release()
        os.unlink(tmp_path)

        if not ret:
            return jsonify({"error": "Could not read video"}), 400

        frame = cv2.resize(frame, (config.width, config.height))
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return jsonify({"error": "Could not encode frame"}), 500

        return jsonify({
            "frame": base64.b64encode(buf).decode("utf-8"),
            "width": config.width,
            "height": config.height,
            "suggested_setup": suggested_setup,
            "tuned_setup": tuned_setup,
            "parameters": asdict(config),
        })
    except Exception as exc:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/live-frame", methods=["POST"])
def live_frame():
    if "frame" not in request.files:
        return jsonify({"error": "No frame uploaded"}), 400

    hybrid_mode = request.form.get("hybrid_mode", "false").lower() == "true"
    frame = decode_uploaded_frame(request.files.get("frame"))
    if frame is None:
        return jsonify({"error": "Could not decode frame"}), 400

    height, width = frame.shape[:2]
    base_config = build_runtime_config(request.form)
    live_mode = request.form.get("live_mode", "true").lower() == "true"
    if live_mode:
        base_config = replace(
            base_config,
            blur_kernel=3,
            diff_threshold=base_config.diff_threshold,
            close_kernel=min(base_config.close_kernel, 3),
            dilate_kernel=min(base_config.dilate_kernel, 3),
            dilate_iterations=min(base_config.dilate_iterations, 1),
            min_contour_area=base_config.min_contour_area,
            max_large_motion_width=max(base_config.max_large_motion_width, 420),
            max_large_motion_height=max(base_config.max_large_motion_height, 240),
            max_detections_per_frame=min(base_config.max_detections_per_frame, 18),
            max_track_distance=max(base_config.max_track_distance, 110),
            fast_track_distance=max(base_config.fast_track_distance, 260),
            min_crossing_distance=min(base_config.min_crossing_distance, 5),
            min_perpendicular_motion=min(base_config.min_perpendicular_motion, 7),
            open_side_min_distance=min(base_config.open_side_min_distance, 28),
        )
    config = replace(base_config, width=width, height=height)

    try:
        geometry = build_geometry(request.form, config)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    prev_frame = decode_uploaded_frame(request.files.get("prev_frame"))
    if prev_frame is None:
        return jsonify({
            "width": width,
            "height": height,
            "motion_pixels": 0,
            "detections": [],
            "message": "First live frame received. Send prev_frame with the next frame for motion detection.",
            "parameters": asdict(config),
        })

    if prev_frame.shape[:2] != frame.shape[:2]:
        prev_frame = cv2.resize(prev_frame, (width, height))

    baseline_frame = decode_uploaded_frame(request.files.get("baseline_frame"))
    if baseline_frame is not None and baseline_frame.shape[:2] != frame.shape[:2]:
        baseline_frame = cv2.resize(baseline_frame, (width, height))

    stabilize_frame = request.form.get("stabilize_frame", "false").lower() == "true"
    diff, gray, live_processing = build_live_diff(prev_frame, frame, config, geometry, stabilize=stabilize_frame)
    use_baseline_gate = baseline_frame is not None and request.form.get("use_baseline_gate", "true").lower() == "true"
    if use_baseline_gate:
        foreground_mask, foreground_gray, foreground_meta = build_baseline_foreground(
            baseline_frame,
            frame,
            config,
            geometry,
        )
        diff = foreground_mask
        gray = foreground_gray
        live_processing["baseline_foreground"] = foreground_meta
    else:
        live_processing["baseline_foreground"] = {"enabled": False}
    motion_pixels = int(cv2.countNonZero(diff))
    min_motion_pixels = read_int(
        request.form,
        "min_motion_pixels",
        max(260, int(width * height * 0.00075)),
        0,
        width * height,
    )
    max_motion_pixels = read_int(
        request.form,
        "max_motion_pixels",
        max(min_motion_pixels + 1, int(width * height * 0.08)),
        1,
        width * height,
    )
    if motion_pixels < min_motion_pixels:
        return jsonify({
            "width": width,
            "height": height,
            "motion_pixels": motion_pixels,
            "min_motion_pixels": min_motion_pixels,
            "max_motion_pixels": max_motion_pixels,
            "detections": [],
            "yolo_detections": [],
            "hybrid": {
                "enabled": hybrid_mode,
                "checked": False,
                "verified_motion": 0,
                "error": None,
            },
            "line": {
                "start": list(geometry["line_start"]),
                "end": list(geometry["line_end"]),
                "hive_point": list(geometry["hive_point"]),
                "hive_side_sign": round(float(geometry["hive_side_sign"]), 2),
            },
            "parameters": asdict(config),
            "live_processing": live_processing,
        })
    if motion_pixels > max_motion_pixels:
        return jsonify({
            "width": width,
            "height": height,
            "motion_pixels": motion_pixels,
            "min_motion_pixels": min_motion_pixels,
            "max_motion_pixels": max_motion_pixels,
            "detections": [],
            "yolo_detections": [],
            "hybrid": {
                "enabled": hybrid_mode,
                "checked": False,
                "verified_motion": 0,
                "error": None,
            },
            "message": "Too much frame-wide motion; likely camera shake or exposure change.",
            "line": {
                "start": list(geometry["line_start"]),
                "end": list(geometry["line_end"]),
                "hive_point": list(geometry["hive_point"]),
                "hive_side_sign": round(float(geometry["hive_side_sign"]), 2),
            },
            "parameters": asdict(config),
            "live_processing": live_processing,
        })

    include_dark_motion = (
        request.form.get("include_dark_motion", "false").lower() == "true"
        and not use_baseline_gate
    )
    detections = detect_motion_boxes(
        diff,
        geometry,
        config,
        gray,
        include_dark_motion=include_dark_motion,
    )
    if use_baseline_gate:
        for detection in detections:
            detection["source"] = "foreground"
    if live_mode:
        detections = filter_live_gate_detections(detections, config)
    yolo_detections = []
    hybrid_error = None
    if hybrid_mode:
        try:
            yolo_conf = float(request.form.get("yolo_conf", 0.15))
            yolo_detections = run_yolo_verification(get_hybrid_model(), frame, conf=yolo_conf)
            for detection in detections:
                detection["yolo_verified"] = detection_matches_yolo(detection, yolo_detections)
        except Exception as exc:
            hybrid_error = str(exc)

    return jsonify({
        "width": width,
        "height": height,
        "motion_pixels": motion_pixels,
        "min_motion_pixels": min_motion_pixels,
        "max_motion_pixels": max_motion_pixels,
        "detections": [serialize_detection(detection, config) for detection in detections],
        "yolo_detections": [serialize_yolo_detection(detection) for detection in yolo_detections],
        "hybrid": {
            "enabled": hybrid_mode,
            "checked": hybrid_mode and hybrid_error is None,
            "verified_motion": sum(1 for detection in detections if detection.get("yolo_verified")),
            "error": hybrid_error,
            "model": COUNT_MODEL_PATH,
        },
        "line": {
            "start": list(geometry["line_start"]),
            "end": list(geometry["line_end"]),
            "hive_point": list(geometry["hive_point"]),
            "hive_side_sign": round(float(geometry["hive_side_sign"]), 2),
        },
        "parameters": asdict(config),
        "live_processing": live_processing,
    })


@app.route("/api/count-video", methods=["POST"])
def count_video():
    if "video" not in request.files:
        return jsonify({"error": "No video uploaded"}), 400

    config = build_runtime_config(request.form)

    try:
        geometry = build_geometry(request.form, config)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    debug_mode = request.form.get("debug", "false").lower() == "true"
    trial_mode = request.form.get("trial_mode", "motion").lower()
    if trial_mode not in ("motion", "hybrid"):
        trial_mode = "motion"
    file = request.files["video"]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
        file.save(tmp_in.name)
        input_path = tmp_in.name

    output_path = input_path.replace(".mp4", "_motion_counted.mp4")

    try:
        result = process_count_video(input_path, output_path, geometry, config, debug_mode, trial_mode)

        with open(output_path, "rb") as video_file:
            result["video_b64"] = base64.b64encode(video_file.read()).decode("utf-8")

        os.unlink(input_path)
        os.unlink(output_path)
        return jsonify(result)
    except Exception as exc:
        app.logger.exception("Frame differencing count failed")
        for path in [input_path, output_path]:
            if os.path.exists(path):
                os.unlink(path)
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
