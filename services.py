from __future__ import annotations
import asyncio
import ctypes
import gc
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from aiohttp import web
import folder_paths
from server import PromptServer

_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'}
_VIDEO_EDITOR_SUBFOLDER = 'h3_image_workbench'
_ASSET_METADATA = 'metadata.json'
_ASSET_LOCK = 'metadata.lock'
_ASSET_CATEGORIES = {'character': '角色资产', 'scene': '场景资产', 'prop': '道具资产', 'other': '其他资产', 'camera': '运镜资产', 'blocking': '站位资产'}
_REPARSE_POINT = 0x400
_MAX_COMMON_ASSET_BYTES = 128 * 1024 * 1024

class _AssetLibraryError(RuntimeError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def _asset_error(error):
    if isinstance(error, _AssetLibraryError):
        return web.json_response({"error": str(error), "code": error.code}, status=error.status)
    return web.json_response({"error": str(error), "code": "asset_operation_failed"}, status=500)


def _is_reparse(path: Path) -> bool:
    try:
        return bool(getattr(os.lstat(path), "st_file_attributes", 0) & _REPARSE_POINT)
    except OSError:
        return False


def _safe_asset_category_name(value: str) -> str:
    name = str(value or "").strip()
    if not name or len(name) > 60 or name in {".", ".."} or name.startswith(".") or any(char in name for char in '<>:"/\\|?*') or name.endswith((" ", ".")):
        raise _AssetLibraryError("asset_category_name_invalid", "资产分类名称无效")
    return name


def _asset_categories(root: Path):
    categories = dict(_ASSET_CATEGORIES)
    if root.is_dir():
        for path in root.iterdir():
            if not path.is_dir() or path.is_symlink() or _is_reparse(path) or path.name in _ASSET_CATEGORIES.values():
                continue
            categories[f"custom:{path.name}"] = path.name
    return categories


def _asset_category_directory(root: Path, category: str) -> str:
    directory = _asset_categories(root).get(str(category or ""))
    if not directory:
        raise _AssetLibraryError("asset_category_invalid", "未知资产分类")
    return directory


def _asset_root() -> Path:
    # Own library: never discover or reuse the legacy shared asset directory.
    configured = str(os.environ.get('COMFYUI_H3_IMAGE_ASSET_ROOT') or '').strip()
    target = Path(configured).expanduser() if configured else Path(folder_paths.get_user_directory()) / 'comfyui-h3-image-workbench' / 'assets'
    target = target.resolve()
    try:
        target.mkdir(parents=True, exist_ok=True)
        if not target.is_dir() or target.is_symlink() or _is_reparse(target):
            raise OSError('资产库路径不是普通目录')
        return target
    except OSError as error:
        raise _AssetLibraryError('asset_root_create_failed', f'H3 生图工作台资产库创建失败：{error}') from error


def _ensure_asset_categories(root: Path, selection: str) -> None:
    categories = tuple(_ASSET_CATEGORIES) if selection == "all" else (selection,)
    for category in categories:
        if category in _ASSET_CATEGORIES:
            directory = _ASSET_CATEGORIES[category]
        else:
            directory = _asset_category_directory(root, category)
        category_dir = root / directory
        try:
            category_dir.mkdir(exist_ok=True)
        except OSError as error:
            raise _AssetLibraryError(
                "asset_category_create_failed",
                f"资产分类目录自动创建失败：{category_dir}（{error}）",
            ) from error
        if not category_dir.is_dir() or category_dir.is_symlink() or _is_reparse(category_dir):
            raise _AssetLibraryError(
                "asset_category_create_failed",
                f"资产分类目录不可用：{category_dir}",
            )


def _utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _asset_relative(root: Path, category, filename):
    return f"{_asset_category_directory(root, category)}/{filename}".replace("\\", "/")


def _checked_asset_path(root: Path, relative_path: str, must_exist=True) -> Path:
    normalized = str(relative_path or "").replace("\\", "/")
    parts = Path(normalized).parts
    if len(parts) != 2 or parts[0] not in _asset_categories(root).values() or any(part in {"", ".", ".."} for part in parts):
        raise _AssetLibraryError("asset_path_outside_root", "资产相对路径无效")
    parent = (root / parts[0]).resolve()
    try:
        parent.relative_to(root)
    except ValueError as error:
        raise _AssetLibraryError("asset_path_outside_root", "资产路径越过公共资产库") from error
    if not parent.is_dir() or parent.is_symlink() or _is_reparse(parent):
        raise _AssetLibraryError("asset_reparse_point_rejected", "资产分类目录不是普通目录")
    candidate = parent / parts[1]
    if must_exist:
        if not candidate.is_file():
            raise _AssetLibraryError("asset_source_missing", f"公共资产不存在：{normalized}", 404)
        if candidate.is_symlink() or _is_reparse(candidate):
            raise _AssetLibraryError("asset_reparse_point_rejected", "拒绝读取链接或重解析点资产")
    return candidate


def _sha256_file(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _mime_type(path: Path):
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _read_asset_index(root: Path):
    path = root / _ASSET_METADATA
    if not path.is_file():
        return {"schemaVersion": 1, "assets": []}, True, "未找到 metadata.json，已根据六类文件夹重建"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("assets"), list):
            raise ValueError("metadata.json 结构无效")
        return {"schemaVersion": 1, "assets": payload["assets"]}, False, ""
    except (OSError, ValueError, json.JSONDecodeError) as error:
        backup = root / f"metadata.corrupt-{int(time.time())}.json"
        try:
            shutil.copy2(path, backup)
        except OSError:
            pass
        return {"schemaVersion": 1, "assets": []}, True, f"metadata.json 已损坏，已保留副本并重建：{error}"


def _write_asset_index(root: Path, assets):
    destination = root / _ASSET_METADATA
    temporary = root / f"metadata.json.tmp-{os.getpid()}-{uuid.uuid4().hex}"
    payload = json.dumps({"schemaVersion": 1, "assets": assets}, ensure_ascii=False, indent=2).encode("utf-8")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if os.name == "nt":
            move_file = ctypes.windll.kernel32.MoveFileExW
            move_file.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
            move_file.restype = ctypes.c_int
            result = move_file(str(temporary), str(destination), 0x1 | 0x8)
            if not result:
                raise ctypes.WinError()
        else:
            os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def _asset_metadata_lock(root: Path):
    lock_path = root / _ASSET_LOCK
    for _ in range(100):
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(f"{os.getpid()}:{int(time.time())}\n")
            break
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > 120:
                    lock_path.unlink(missing_ok=True)
            except OSError:
                pass
            time.sleep(.02)
    else:
        raise _AssetLibraryError("asset_metadata_locked", "资产库正在被其他窗口修改，请稍后重试", 409)
    try:
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def _reconcile_asset_library(root: Path):
    index, recovered, recovery_message = _read_asset_index(root)
    indexed_by_path = {}
    indexed_by_hash = {}
    for item in index["assets"]:
        if not isinstance(item, dict):
            continue
        relative = str(item.get("relativePath") or "").replace("\\", "/")
        indexed_by_path[relative] = item
        content_hash = str(item.get("contentHash") or "").upper()
        if content_hash:
            indexed_by_hash.setdefault(content_hash, []).append(item)
    used_ids = set()
    assets = []
    category_map = _asset_categories(root)
    for category, directory in category_map.items():
        category_root = root / directory
        if not category_root.is_dir() or category_root.is_symlink() or _is_reparse(category_root):
            continue
        for path in category_root.iterdir():
            if not path.is_file() or path.is_symlink() or _is_reparse(path):
                continue
            relative = _asset_relative(root, category, path.name)
            content_hash = _sha256_file(path)
            prior = indexed_by_path.get(relative)
            if prior is None:
                prior = next((item for item in indexed_by_hash.get(content_hash, []) if str(item.get("id")) not in used_ids), None)
            now = _utc_now()
            asset_id = str(prior.get("id") if prior else "").strip() or f"asset-{uuid.uuid4().hex[:24]}"
            used_ids.add(asset_id)
            name = str(prior.get("name") if prior else "").strip() or path.stem or "未命名资产"
            item = {
                "id": asset_id,
                "relativePath": relative,
                "name": name,
                "note": str(prior.get("note") if prior else "").strip(),
                "category": category,
                "mimeType": _mime_type(path),
                "contentHash": content_hash,
                "createdAt": str(prior.get("createdAt") if prior else "").strip() or now,
                "updatedAt": str(prior.get("updatedAt") if prior else "").strip() or now,
                "sizeBytes": path.stat().st_size,
            }
            assets.append(item)
    assets.sort(key=lambda item: (item["updatedAt"], item["name"]), reverse=True)
    _write_asset_index(root, [{key: value for key, value in item.items() if key != "sizeBytes"} for item in assets])
    return {
        "schemaVersion": 1,
        "root": str(root),
        "categories": [{"id": category, "name": directory} for category, directory in category_map.items()],
        "assets": assets,
        "recoveredMetadata": recovered,
        "recoveryMessage": recovery_message,
    }


def _asset_snapshot():
    root = _asset_root()
    with _asset_metadata_lock(root):
        return root, _reconcile_asset_library(root)


def _safe_file_name(value):
    value = Path(str(value or "").strip()).name
    if not value or value in {".", ".."} or any(char in value for char in '<>:"/\\|?*') or value.endswith((" ", ".")):
        raise _AssetLibraryError("asset_invalid_filename", "资产文件名无效")
    return value


def _unique_asset_path(parent: Path, requested):
    requested = Path(_safe_file_name(requested))
    for index in range(10000):
        name = requested.name if index == 0 else f"{requested.stem} ({index}){requested.suffix}"
        candidate = parent / name
        if not candidate.exists():
            return candidate
    raise _AssetLibraryError("asset_duplicate_limit", "同名资产过多，无法保存")


def _snapshot_asset(snapshot, asset_id):
    asset = next((item for item in snapshot["assets"] if item["id"] == str(asset_id)), None)
    if asset is None:
        raise _AssetLibraryError("asset_source_missing", "没有找到公共资产", 404)
    return asset


@PromptServer.instance.routes.get("/xiantu/h3-image-workbench/common-assets")
async def list_common_assets(_request):
    try:
        _root, snapshot = _asset_snapshot()
        return web.json_response(snapshot)
    except Exception as error:
        return _asset_error(error)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/common-assets/categories")
async def create_common_asset_category(request):
    try:
        payload = await request.json()
        name = _safe_asset_category_name(payload.get("name"))
        root = _asset_root()
        existing = next(((category, directory) for category, directory in _asset_categories(root).items() if directory.casefold() == name.casefold()), None)
        if existing:
            return web.json_response({"ok": True, "category": {"id": existing[0], "name": existing[1]}})
        destination = (root / name).resolve()
        destination.relative_to(root)
        destination.mkdir(exist_ok=False)
        if destination.is_symlink() or _is_reparse(destination):
            raise _AssetLibraryError("asset_category_create_failed", "资产分类目录不可用")
        return web.json_response({"ok": True, "category": {"id": f"custom:{name}", "name": name}})
    except Exception as error:
        return _asset_error(error)


@PromptServer.instance.routes.get("/xiantu/h3-image-workbench/common-assets/content")
async def common_asset_content(request):
    try:
        root = _asset_root()
        index, _recovered, _message = _read_asset_index(root)
        asset = next((item for item in index["assets"] if isinstance(item, dict) and str(item.get("id")) == str(request.query.get("id") or "")), None)
        if asset is None:
            raise _AssetLibraryError("asset_source_missing", "没有找到公共资产", 404)
        path = _checked_asset_path(root, asset.get("relativePath"))
        return web.FileResponse(path, headers={"Cache-Control": "no-cache"})
    except Exception as error:
        return _asset_error(error)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/common-assets/import")
async def import_common_asset(request):
    try:
        reader = await request.multipart()
        fields = {"category": "other", "library_scope": "", "name": "", "note": ""}
        file_name = ""
        file_bytes = None
        while field := await reader.next():
            if field.name == "media" and field.filename:
                file_name = Path(field.filename).name
                file_bytes = await field.read(decode=False)
            elif field.name in fields:
                fields[field.name] = await field.text()
        if not file_bytes or len(file_bytes) > _MAX_COMMON_ASSET_BYTES:
            raise _AssetLibraryError("asset_import_invalid", "资产为空或超过 128 MiB")
        root = _asset_root()
        categories = _asset_categories(root)
        category = fields["category"] if fields["category"] in categories else "other"
        scope = fields["library_scope"] if fields["library_scope"] in (*categories, "all") else category
        _ensure_asset_categories(root, scope)
        with _asset_metadata_lock(root):
            snapshot = _reconcile_asset_library(root)
            destination = _unique_asset_path(root / _asset_category_directory(root, category), file_name)
            with destination.open("xb") as handle:
                handle.write(file_bytes)
                handle.flush()
                os.fsync(handle.fileno())
            snapshot = _reconcile_asset_library(root)
            relative = _asset_relative(root, category, destination.name)
            asset = next(item for item in snapshot["assets"] if item["relativePath"] == relative)
            asset["name"] = str(fields["name"] or "").strip()[:200] or destination.stem
            asset["note"] = str(fields["note"] or "").strip()[:2000]
            asset["updatedAt"] = _utc_now()
            _write_asset_index(root, [{key: value for key, value in item.items() if key != "sizeBytes"} for item in snapshot["assets"]])
        return web.json_response({"ok": True, "asset": asset})
    except Exception as error:
        return _asset_error(error)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/common-assets/update")
async def update_common_asset(request):
    try:
        payload = await request.json()
        root = _asset_root()
        with _asset_metadata_lock(root):
            snapshot = _reconcile_asset_library(root)
            asset = _snapshot_asset(snapshot, payload.get("id"))
            new_category = str(payload.get("category") or asset["category"])
            if new_category not in _asset_categories(root):
                raise _AssetLibraryError("asset_category_invalid", "未知资产分类")
            if new_category != asset["category"]:
                source = _checked_asset_path(root, asset["relativePath"])
                destination = _unique_asset_path(root / _asset_category_directory(root, new_category), source.name)
                os.replace(source, destination)
                asset["relativePath"] = _asset_relative(root, new_category, destination.name)
                asset["category"] = new_category
            if "name" in payload:
                name = str(payload.get("name") or "").strip()
                if not name or len(name) > 200 or "\n" in name or "\r" in name:
                    raise _AssetLibraryError("asset_name_invalid", "资产名称必须为 1 至 200 个字符且不能换行")
                asset["name"] = name
            if "note" in payload:
                note = str(payload.get("note") or "").strip()
                if len(note) > 2000:
                    raise _AssetLibraryError("asset_note_invalid", "资产备注不能超过 2000 个字符")
                asset["note"] = note
            asset["updatedAt"] = _utc_now()
            _write_asset_index(root, [{key: value for key, value in item.items() if key != "sizeBytes"} for item in snapshot["assets"]])
        return web.json_response({"ok": True, "asset": asset})
    except Exception as error:
        return _asset_error(error)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/common-assets/delete")
async def delete_common_assets(request):
    try:
        payload = await request.json()
        ids = {str(value) for value in payload.get("ids", [])}
        root = _asset_root()
        with _asset_metadata_lock(root):
            snapshot = _reconcile_asset_library(root)
            for asset in snapshot["assets"]:
                if asset["id"] in ids:
                    _checked_asset_path(root, asset["relativePath"]).unlink()
            snapshot = _reconcile_asset_library(root)
        return web.json_response({"ok": True, "snapshot": snapshot})
    except Exception as error:
        return _asset_error(error)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/common-assets/apply")
async def apply_common_assets(request):
    """The only common-library operation allowed to write into ComfyUI/input."""
    try:
        payload = await request.json()
        ids = [str(value) for value in payload.get("ids", [])]
        root, snapshot = _asset_snapshot()
        input_root = Path(folder_paths.get_input_directory()).resolve()
        target_dir = input_root / _VIDEO_EDITOR_SUBFOLDER
        target_dir.mkdir(parents=True, exist_ok=True)
        applied = []
        for asset_id in ids:
            asset = _snapshot_asset(snapshot, asset_id)
            source = _checked_asset_path(root, asset["relativePath"])
            safe_stem = "".join(char if char.isalnum() or char in "-_" else "_" for char in source.stem).strip("_") or "asset"
            target_name = f"{safe_stem}_{asset['contentHash'][:12].lower()}{source.suffix.lower()}"
            target = target_dir / target_name
            if not target.exists():
                shutil.copy2(source, target)
            applied.append({
                "id": asset["id"],
                "name": asset["name"],
                "note": asset["note"],
                "category": asset["category"],
                "contentHash": asset["contentHash"],
                "sourceRelativePath": asset["relativePath"],
                "filename": target_name,
                "subfolder": _VIDEO_EDITOR_SUBFOLDER,
                "type": "input",
                "mimeType": asset["mimeType"],
            })
        return web.json_response({"ok": True, "assets": applied})
    except OSError as error:
        return _asset_error(_AssetLibraryError("asset_input_copy_failed", f"复制资产到 ComfyUI/input 失败：{error}", 500))
    except Exception as error:
        return _asset_error(error)


def _error(message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": message}, status=status)


def _sync_finalized_name_to_history(old_name: str, new_name: str, subfolder: str) -> None:
    """Keep ComfyUI history/native previews aligned with an atomic rename."""
    queue = getattr(PromptServer.instance, "prompt_queue", None)
    history = getattr(queue, "history", None)
    mutex = getattr(queue, "mutex", None)
    if not isinstance(history, dict) or mutex is None:
        return

    normalized_subfolder = str(subfolder or "").replace("\\", "/").strip("/")

    def visit(value):
        if isinstance(value, dict):
            current_subfolder = str(value.get("subfolder") or "").replace("\\", "/").strip("/")
            if str(value.get("filename") or "") == old_name and current_subfolder == normalized_subfolder:
                value["filename"] = new_name
                if str(value.get("name") or "") == old_name:
                    value["name"] = new_name
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    with mutex:
        visit(history)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/rename-output")
async def rename_image_output(request):
    try:
        payload = await request.json()
        record = payload.get("record") if isinstance(payload, dict) else None
        if not isinstance(record, dict) or str(record.get("type") or "output") != "output":
            raise ValueError("只能改名输出目录中的图片")
        output_root = Path(folder_paths.get_output_directory()).resolve()
        old_name = Path(str(record.get("name") or record.get("filename") or "")).name
        subfolder = str(record.get("subfolder") or "").replace("\\", "/").strip("/")
        source = (output_root / subfolder / old_name).resolve()
        source.relative_to(output_root)
        if not source.is_file() or source.suffix.lower() not in _IMAGE_EXTENSIONS:
            raise FileNotFoundError(old_name)
        requested = Path(_safe_file_name(payload.get("name"))).name
        if not Path(requested).suffix:
            requested = f"{requested}{source.suffix.lower()}"
        if Path(requested).suffix.lower() != source.suffix.lower():
            raise ValueError("改名时不能修改图片格式")
        destination = source.with_name(requested).resolve()
        destination.relative_to(output_root)
        if destination != source and destination.exists():
            return _error("同目录已存在这个文件名", status=409)
        if destination != source:
            os.replace(source, destination)
            _sync_finalized_name_to_history(old_name, destination.name, subfolder)
        return web.json_response({"ok": True, "record": {"name": destination.name, "subfolder": subfolder, "type": "output"}})
    except FileNotFoundError as error:
        return _error(f"找不到输出图片：{error}", status=404)
    except (ValueError, OSError) as error:
        return _error(f"图片改名失败：{error}")


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/delete-outputs")
async def delete_image_outputs(request):
    try:
        payload = await request.json()
        records = payload.get("records") if isinstance(payload, dict) else None
        if not isinstance(records, list) or not records or len(records) > 100:
            raise ValueError("删除列表无效")
        output_root = Path(folder_paths.get_output_directory()).resolve()
        targets = {}
        for record in records:
            if not isinstance(record, dict) or str(record.get("type") or "output") != "output":
                raise ValueError("只能删除输出目录中的图片")
            name = Path(str(record.get("name") or record.get("filename") or "")).name
            subfolder = str(record.get("subfolder") or "").replace("\\", "/").strip("/")
            target = (output_root / subfolder / name).resolve()
            target.relative_to(output_root)
            if not name or target.suffix.lower() not in _IMAGE_EXTENSIONS:
                raise ValueError("输出图片路径无效")
            if target.exists() and (not target.is_file() or target.is_symlink() or _is_reparse(target)):
                raise ValueError("拒绝删除链接或非普通文件")
            targets[(subfolder, name)] = target
        deleted = []
        missing = []
        for (subfolder, name), target in targets.items():
            if target.is_file():
                target.unlink()
                deleted.append({"name": name, "subfolder": subfolder, "type": "output"})
            else:
                missing.append({"name": name, "subfolder": subfolder, "type": "output"})
        queue = getattr(PromptServer.instance, "prompt_queue", None)
        history = getattr(queue, "history", None)
        mutex = getattr(queue, "mutex", None)
        if isinstance(history, dict) and mutex is not None:
            keys = set(targets)
            def matches(value):
                return isinstance(value, dict) and (str(value.get("subfolder") or "").replace("\\", "/").strip("/"), str(value.get("filename") or value.get("name") or "")) in keys
            def scrub(value):
                if isinstance(value, dict):
                    for child in value.values():
                        scrub(child)
                elif isinstance(value, list):
                    value[:] = [child for child in value if not matches(child)]
                    for child in value:
                        scrub(child)
            with mutex:
                scrub(history)
        return web.json_response({"ok": True, "deleted": deleted, "missing": missing})
    except (ValueError, OSError) as error:
        return _error(f"删除输出图片失败：{error}")


@PromptServer.instance.routes.get("/xiantu/h3-image-workbench/hardware")
async def video_editor_hardware(_request):
    """Small local hardware snapshot for the director header."""
    data = {"cpu": None, "memory": None, "vram": None, "temperature": None}
    try:
        import psutil
        data["cpu"] = round(float(psutil.cpu_percent(interval=None)), 1)
        data["memory"] = round(float(psutil.virtual_memory().percent), 1)
    except Exception:
        pass
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False,
        )
        first = completed.stdout.strip().splitlines()[0]
        used, total, temperature = [float(item.strip()) for item in first.split(",")[:3]]
        data["vram"] = round(used / max(1.0, total) * 100.0, 1)
        data["temperature"] = round(temperature, 1)
    except Exception:
        pass
    return web.json_response(data)


@PromptServer.instance.routes.post("/xiantu/h3-image-workbench/cleanup")
async def video_editor_cleanup(request):
    """Release only the resources explicitly selected by the user."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    released = []
    warnings = []
    if bool(payload.get("models")):
        try:
            import comfy.model_management as model_management
            model_management.unload_all_models()
            released.append("models")
        except Exception as error:
            warnings.append(f"卸载模型失败：{error}")
    if bool(payload.get("cache")):
        try:
            gc.collect()
            released.append("cache")
        except Exception as error:
            warnings.append(f"卸载缓存失败：{error}")
    if bool(payload.get("vram")):
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            released.append("vram")
        except Exception as error:
            warnings.append(f"卸载显存失败：{error}")
    return web.json_response({"ok": True, "released": released, "warnings": warnings})
