from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a YOLO train/val dataset from labeled source folders."
    )
    parser.add_argument(
        "--sources",
        nargs="+",
        default=["backend/dataset/motion_candidates", "backend/dataset/sampled_frames"],
        help="Source folders containing images and YOLO .txt labels.",
    )
    parser.add_argument(
        "--output",
        default="backend/yolo_dataset",
        help="Output YOLO dataset root.",
    )
    parser.add_argument(
        "--label-dirs",
        nargs="*",
        default=["backend/dataset/label"],
        help="Optional folders containing YOLO .txt labels keyed by image stem.",
    )
    parser.add_argument(
        "--val-ratio",
        type=float,
        default=0.2,
        help="Validation split ratio, e.g. 0.2 for 20%%.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducible split.",
    )
    parser.add_argument(
        "--require-labels",
        action="store_true",
        help="Fail if any image is missing its .txt label.",
    )
    return parser.parse_args()


def resolve_label_path(image_path: Path, label_dirs: list[Path]) -> Path | None:
    direct_label = image_path.with_suffix(".txt")
    if direct_label.exists():
        return direct_label

    for label_dir in label_dirs:
        candidate = label_dir / f"{image_path.stem}.txt"
        if candidate.exists():
            return candidate

    return None


def find_labeled_items(
    source_dirs: list[Path],
    label_dirs: list[Path],
    require_labels: bool,
) -> list[tuple[Path, Path]]:
    items: list[tuple[Path, Path]] = []
    seen_stems: set[str] = set()
    duplicate_stems: list[Path] = []
    missing_labels: list[Path] = []

    for source_dir in source_dirs:
        if not source_dir.exists():
            raise FileNotFoundError(f"Source folder not found: {source_dir}")

        for path in sorted(source_dir.iterdir()):
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue

            label_path = resolve_label_path(path, label_dirs)
            if label_path is None:
                missing_labels.append(path)
                continue

            if path.stem in seen_stems:
                duplicate_stems.append(path)
                continue

            seen_stems.add(path.stem)
            items.append((path, label_path))

    if require_labels and missing_labels:
        sample = "\n".join(str(path) for path in missing_labels[:10])
        raise FileNotFoundError(
            f"Found {len(missing_labels)} images without labels. Sample:\n{sample}"
        )

    if duplicate_stems:
        sample = ", ".join(path.name for path in duplicate_stems[:5])
        print(
            f"Skipped {len(duplicate_stems)} duplicate image stems already present "
            f"from an earlier source. Sample: {sample}"
        )

    return items


def ensure_dirs(dataset_root: Path) -> None:
    for rel in [
        "images/train",
        "images/val",
        "labels/train",
        "labels/val",
    ]:
        (dataset_root / rel).mkdir(parents=True, exist_ok=True)


def clear_split_dirs(dataset_root: Path) -> None:
    for rel in [
        "images/train",
        "images/val",
        "labels/train",
        "labels/val",
    ]:
        split_dir = dataset_root / rel
        for child in split_dir.iterdir():
            if child.is_file():
                child.unlink()


def copy_split(items: list[tuple[Path, Path]], split_name: str, dataset_root: Path) -> None:
    image_dir = dataset_root / "images" / split_name
    label_dir = dataset_root / "labels" / split_name

    for image_path, label_path in items:
        shutil.copy2(image_path, image_dir / image_path.name)
        shutil.copy2(label_path, label_dir / label_path.name)


def main() -> None:
    args = parse_args()
    source_dirs = [Path(path) for path in args.sources]
    label_dirs = [Path(path) for path in args.label_dirs]
    dataset_root = Path(args.output)

    items = find_labeled_items(
        source_dirs,
        label_dirs,
        require_labels=args.require_labels,
    )
    if not items:
        raise SystemExit(
            "No labeled images found. Label your images first, then run this script again."
        )

    ensure_dirs(dataset_root)
    clear_split_dirs(dataset_root)

    random.seed(args.seed)
    random.shuffle(items)

    val_count = max(1, int(len(items) * args.val_ratio)) if len(items) > 1 else 0
    val_items = items[:val_count]
    train_items = items[val_count:]

    copy_split(train_items, "train", dataset_root)
    copy_split(val_items, "val", dataset_root)

    print(f"Prepared dataset at: {dataset_root}")
    print(f"Train images: {len(train_items)}")
    print(f"Val images: {len(val_items)}")
    print(f"Sources: {', '.join(str(path) for path in source_dirs)}")
    print(f"Label dirs: {', '.join(str(path) for path in label_dirs)}")


if __name__ == "__main__":
    main()
