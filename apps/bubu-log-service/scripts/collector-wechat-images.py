#!/usr/bin/env python3
"""Exact offline WeChat image exporter for one explicitly supplied account/chat.

The stdin protocol is deliberately narrow: callers provide already-selected image
SourceMessage objects and explicit live paths.  XML credentials, account keys and
database contents never enter stdout or logs.
"""
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import sys
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

from Crypto.Cipher import AES
from wechat_cli.core import messages as wc


MAX_BYTES = 10 * 1024 * 1024
V2_MAGIC = b"\x07\x08V2\x08\x07"
SAFE_DAT = re.compile(r"[a-f0-9]{32}(?:_h|_t)?\.dat")


def require_string(value, pattern, code):
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
        raise ValueError(code)
    return value


def source_id(account, database, table, local_id):
    data = json.dumps(["wechat", account, database, table, local_id], separators=(",", ":"), ensure_ascii=False)
    return "wechat:" + hashlib.sha256(data.encode()).hexdigest()


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("INVALID_SENT_AT")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("INVALID_SENT_AT") from None
    if parsed.tzinfo is None or parsed.microsecond:
        raise ValueError("INVALID_SENT_AT")
    seconds = int(parsed.timestamp())
    if datetime.fromtimestamp(seconds, parsed.tzinfo) != parsed:
        raise ValueError("INVALID_SENT_AT")
    return seconds


def validate_request(request):
    if not isinstance(request, dict):
        raise ValueError("INVALID_REQUEST")
    account = require_string(request.get("accountId"), r"[\w.-]{1,128}", "INVALID_ACCOUNT")
    chat = require_string(request.get("chatId"), r"[\w.-]{1,160}@chatroom", "BOUND_GROUP_REQUIRED")
    group = "wechat:" + account + ":" + chat
    table = "Msg_" + hashlib.md5(chat.encode()).hexdigest()
    if request.get("allowLive") is not True or not isinstance(request.get("configPath"), str) or not request["configPath"]:
        raise ValueError("LIVE_IMAGE_EXPORT_DISABLED")
    output = pathlib.Path(request.get("outputDirectory", ""))
    kvcomm = pathlib.Path(request.get("kvcommDirectory", ""))
    if not output.is_absolute() or not kvcomm.is_absolute():
        raise ValueError("ABSOLUTE_PATH_REQUIRED")
    for tool in ("ffmpeg", "ffprobe"):
        if tool in request and (not isinstance(request[tool], str) or not request[tool]):
            raise ValueError("INVALID_TOOL_PATH")
    messages = request.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 20:
        raise ValueError("INVALID_MESSAGE_COUNT")
    records = []
    for message in messages:
        if not isinstance(message, dict) or message.get("kind") != "image":
            raise ValueError("MEDIA_TYPE_NOT_SUPPORTED")
        if message.get("accountId") != account or message.get("chatId") != chat or message.get("groupId") != group:
            raise ValueError("SOURCE_BOUNDARY_MISMATCH")
        database = require_string(message.get("databaseId"), r"message/message_\d+\.db", "INVALID_DATABASE_ID")
        if message.get("tableName") != table:
            raise ValueError("INVALID_TABLE")
        local_id = message.get("localId")
        if not isinstance(local_id, int) or isinstance(local_id, bool) or local_id < 1:
            raise ValueError("INVALID_LOCAL_ID")
        media = message.get("media")
        if not isinstance(media, list) or len(media) != 1 or not isinstance(media[0], dict) or media[0].get("kind") != "image":
            raise ValueError("INVALID_IMAGE_MEDIA")
        fingerprint = media[0].get("fingerprint")
        match = re.fullmatch(r"md5:([0-9a-fA-F]{32})", fingerprint) if isinstance(fingerprint, str) else None
        if not match:
            raise ValueError("INVALID_XML_MD5")
        expected = source_id(account, database, table, local_id)
        if message.get("sourceId") != expected or media[0].get("sourceId") != expected:
            raise ValueError("INVALID_SOURCE_ID")
        seconds = timestamp(message.get("sentAt"))
        records.append({"sourceId": expected, "index": 0, "databaseId": database, "table": table,
                        "localId": local_id, "seconds": seconds, "xmlMd5": match.group(1).lower()})
    return request, account, chat, output, kvcomm, records


def load_context(request, account):
    from wechat_cli.core.context import AppContext

    app = AppContext(config_path=request["configPath"])
    try:
        if pathlib.Path(app.db_dir).resolve().parent.name != account:
            raise ValueError("SOURCE_ACCOUNT_MISMATCH")
    except Exception:
        app.cache.cleanup()
        raise
    return app


def database_path(app, database_id):
    path = app.cache.get(database_id)
    if not path:
        raise ValueError("SOURCE_DATABASE_UNAVAILABLE")
    return pathlib.Path(path).resolve()


def verify_source_row(path, record, chat):
    uri = pathlib.Path(path).as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        rows = conn.execute(
            f"SELECT local_type,create_time,message_content,WCDB_CT_message_content FROM [{record['table']}] WHERE local_id=?",
            (record["localId"],),
        ).fetchall()
    if len(rows) != 1 or (rows[0][0] & 0xFFFFFFFF) != 3 or rows[0][1] != record["seconds"]:
        raise ValueError("SOURCE_ROW_MISMATCH")
    text = wc.decompress_content(rows[0][2], rows[0][3])
    if text is None:
        raise ValueError("MESSAGE_DECOMPRESSION_FAILED")
    _, xml = wc._parse_message_content(text, rows[0][0], True)
    root = wc._parse_xml_root(xml)
    values = [node.attrib.get("md5", "").lower() for node in root.iter()] if root is not None else []
    if record["xmlMd5"] not in values:
        raise ValueError("SOURCE_XML_MD5_MISMATCH")


def verify_resource_row(path, record, chat):
    uri = pathlib.Path(path).as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        rows = conn.execute(
            "SELECT 1 FROM MessageResourceInfo AS resource "
            "JOIN ChatName2Id AS chat ON chat.rowid=resource.chat_id "
            "WHERE chat.user_name=? AND resource.message_local_id=? AND resource.message_create_time=? "
            "AND (resource.message_local_type & 4294967295)=3",
            (chat, record["localId"], record["seconds"]),
        ).fetchall()
    if len(rows) != 1:
        raise ValueError("RESOURCE_ROW_MISMATCH")


def resolve_hardlink(app, record, chat):
    database = database_path(app, "hardlink/hardlink.db")
    local_month = datetime.fromtimestamp(record["seconds"], ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")
    expected_dir1 = hashlib.md5(chat.encode()).hexdigest()
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as conn:
        rows = conn.execute(
            "SELECT hardlink.file_name,hardlink.file_size FROM image_hardlink_info_v4 AS hardlink "
            "JOIN dir2id AS dir1 ON dir1.rowid=hardlink.dir1 "
            "JOIN dir2id AS dir2 ON dir2.rowid=hardlink.dir2 "
            "WHERE hardlink.md5=? AND dir1.username=? AND dir2.username=?",
            (record["xmlMd5"], expected_dir1, local_month),
        ).fetchall()
    if len(rows) != 1:
        raise ValueError("HARDLINK_AMBIGUOUS_OR_MISSING")
    file_name, size = rows[0]
    if not isinstance(file_name, str) or SAFE_DAT.fullmatch(file_name) is None:
        raise ValueError("UNSAFE_HARDLINK_NAME")
    if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= MAX_BYTES:
        raise ValueError("INVALID_IMAGE_SIZE")
    root = pathlib.Path(app.db_dir).resolve().parent
    lexical = root / "msg" / "attach" / expected_dir1 / local_month / "Img" / file_name
    current = root
    for part in lexical.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("MEDIA_PATH_NOT_ALLOWED")
    resolved = lexical.resolve(strict=True)
    if resolved != lexical or not resolved.is_file() or resolved.stat().st_size > MAX_BYTES:
        raise ValueError("MEDIA_PATH_NOT_ALLOWED")
    record["byteLength"] = size
    return resolved


def decode_v2(data, xor_key, aes_key):
    if not isinstance(data, bytes) or not 15 <= len(data) <= MAX_BYTES or data[:6] != V2_MAGIC:
        raise ValueError("IMAGE_DECODE_FAILED")
    if not isinstance(aes_key, bytes) or len(aes_key) != 16:
        raise ValueError("IMAGE_DECODE_FAILED")
    if not isinstance(xor_key, int) or isinstance(xor_key, bool) or not 0 <= xor_key <= 255:
        raise ValueError("IMAGE_DECODE_FAILED")
    aes_size = int.from_bytes(data[6:10], "little")
    xor_size = int.from_bytes(data[10:14], "little")
    if not 1 <= aes_size <= MAX_BYTES or not 0 <= xor_size <= MAX_BYTES:
        raise ValueError("IMAGE_DECODE_FAILED")
    cipher_size = (aes_size // 16 + 1) * 16
    end = 15 + cipher_size
    if end > len(data) or end + xor_size > len(data):
        raise ValueError("IMAGE_DECODE_FAILED")
    plain = AES.new(aes_key, AES.MODE_ECB).decrypt(data[15:end])
    padding = plain[-1]
    if not 1 <= padding <= 16 or len(plain) - padding != aes_size or plain[-padding:] != bytes([padding]) * padding:
        raise ValueError("IMAGE_DECODE_FAILED")
    middle = data[end:] if xor_size == 0 else data[end:len(data) - xor_size]
    tail = b"" if xor_size == 0 else bytes(byte ^ xor_key for byte in data[len(data) - xor_size:])
    return plain[:-padding] + middle + tail


def normalized_wxid(value):
    match = re.fullmatch(r"wxid_([A-Za-z0-9]+)(?:_[^/\\]+)?", value)
    if not match:
        raise ValueError("INVALID_KEY_CANDIDATE")
    return "wxid_" + match.group(1)


def key_candidates(directory, account):
    lexical = pathlib.Path(directory)
    if not lexical.is_absolute() or lexical.is_symlink() or lexical.resolve(strict=True) != lexical:
        raise ValueError("KEY_DIRECTORY_NOT_ALLOWED")
    normalized_account = normalized_wxid(account)
    entries = sorted(entry for entry in lexical.iterdir() if entry.name.startswith("key_"))
    candidates = set()
    for entry in entries:
        if entry.is_symlink():
            continue
        match = re.fullmatch(r"key_([0-9]+)_[^/\\]+\.statistic", entry.name)
        if not match:
            continue
        uin = int(match.group(1))
        if not 1 <= uin <= 4294967295:
            continue
        seed = str(uin).encode() + normalized_account.encode()
        candidates.add((hashlib.md5(seed).hexdigest()[:16].encode("ascii"), uin & 255))
    if len(candidates) > 100:
        raise ValueError("TOO_MANY_KEY_CANDIDATES")
    if not candidates:
        raise ValueError("IMAGE_KEY_UNAVAILABLE")
    return sorted(candidates)


def image_extension(data):
    if data.startswith(b"wxgf"):
        return "wxgf"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise ValueError("IMAGE_SIGNATURE_UNSUPPORTED")


def decoded_record(record, encrypted, xor_key, aes_key):
    plain = decode_v2(encrypted, xor_key, aes_key)
    if len(plain) != record["byteLength"] or hashlib.md5(plain).hexdigest() != record["xmlMd5"]:
        raise ValueError("IMAGE_VERIFICATION_FAILED")
    return plain, image_extension(plain)


def select_key(candidates, records):
    winners = []
    for candidate in candidates:
        successes = []
        for record in records:
            try:
                successes.append((record, *decoded_record(record, record["encrypted"], candidate[1], candidate[0])))
            except ValueError:
                continue
                continue
        if successes:
            winners.append((candidate, successes))
    if not winners:
        raise ValueError("IMAGE_VERIFICATION_FAILED")
    if len(winners) != 1:
        raise ValueError("IMAGE_KEY_SELECTION_FAILED")
    return winners[0]


def decode_wxgf_image(data, ffmpeg, ffprobe):
    if not isinstance(ffmpeg, str) or not ffmpeg or not isinstance(ffprobe, str) or not ffprobe:
        raise ValueError("WXGF_TOOLS_REQUIRED")
    try:
        from collector_wxgf import WxgfError, decode_wxgf
    except ImportError:
        raise ValueError("WXGF_DECODER_UNAVAILABLE") from None
    try:
        return decode_wxgf(data, ffmpeg, ffprobe)
    except WxgfError as error:
        raise ValueError(error.code) from None


def prepare_output_directory(path):
    if path.is_symlink() or (path.exists() and (not path.is_dir() or path.resolve() != path)):
        raise ValueError("OUTPUT_PATH_NOT_ALLOWED")
    if not path.exists():
        path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        path.mkdir(mode=0o700)
    path.chmod(0o700)
    if path.resolve(strict=True) != path or (path.stat().st_mode & 0o777) != 0o700:
        raise ValueError("OUTPUT_PATH_NOT_ALLOWED")


def atomic_private_write(directory, name, data):
    target = directory / name
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise ValueError("OUTPUT_PATH_NOT_ALLOWED")
    descriptor, temporary = tempfile.mkstemp(prefix="." + name + ".", dir=directory)
    temporary_path = pathlib.Path(temporary)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if target.exists() and target.read_bytes() != data:
            raise ValueError("OUTPUT_FILE_ALREADY_EXISTS")
        os.replace(temporary, target)
        target.chmod(0o600)
    finally:
        temporary_path.unlink(missing_ok=True)
    return target


def export_images(request):
    request, account, chat, output_directory, kvcomm_directory, records = validate_request(request)
    prepare_output_directory(output_directory)
    candidates = key_candidates(kvcomm_directory, account)
    app = load_context(request, account)
    results = []
    mappings = []
    try:
        resource = database_path(app, "message/message_resource.db")
        for record in records:
            result = {"sourceId": record["sourceId"], "index": record["index"], "status": "unavailable",
                      "reason": "IMAGE_PROVENANCE_FAILED", "xmlMd5": record["xmlMd5"]}
            results.append(result)
            try:
                source = database_path(app, record["databaseId"])
                verify_source_row(source, record, chat)
                verify_resource_row(resource, record, chat)
                media = resolve_hardlink(app, record, chat)
                encrypted = media.read_bytes()
                if len(encrypted) != media.stat().st_size:
                    raise ValueError("MEDIA_CHANGED")
                record["encrypted"] = encrypted
                record["result"] = result
            except ValueError as error:
                if re.fullmatch(r"[A-Z][A-Z0-9_]+", str(error)):
                    result["reason"] = str(error)
            except OSError:
                result["reason"] = "MEDIA_UNAVAILABLE"
        ready = [record for record in records if "encrypted" in record]
        decoded = []
        selection_failure_reason = None
        if ready:
            try:
                _, decoded = select_key(candidates, ready)
            except ValueError as error:
                selection_failure_reason = str(error)
                for record in ready:
                    record["result"]["reason"] = selection_failure_reason
        successful_sources = {id(record) for record, _plain, _extension in decoded}
        for record in ready:
            if id(record) not in successful_sources and selection_failure_reason is None:
                record["result"]["reason"] = "IMAGE_VERIFICATION_FAILED"
        for record, plain, extension in decoded:
            record["result"]["reason"] = "IMAGE_WRITE_FAILED"
            try:
                if extension == "wxgf":
                    output = decode_wxgf_image(plain, request.get("ffmpeg"), request.get("ffprobe"))
                    output_format = "png"
                    atomic_private_write(output_directory, record["xmlMd5"] + ".wxgf", plain)
                else:
                    output = plain
                    output_format = extension
                path = atomic_private_write(output_directory, record["xmlMd5"] + "." + output_format, output)
            except ValueError as error:
                reason = str(error)
                if re.fullmatch(r"[A-Z][A-Z0-9_]+", reason):
                    record["result"]["reason"] = reason
                continue
            except OSError:
                record["result"]["reason"] = "IMAGE_WRITE_FAILED"
                continue
            output_sha256 = hashlib.sha256(output).hexdigest()
            mappings.append({"sourceId": record["sourceId"], "index": record["index"],
                             "path": str(path), "sha256": output_sha256})
            record["result"].pop("reason")
            record["result"].update(
                status="exported",
                decodedMd5=hashlib.md5(plain).hexdigest(),
                rawByteLength=len(plain),
                sourceFormat=extension,
                transformed=extension == "wxgf",
                outputSha256=output_sha256,
                byteLength=len(output),
            )
    finally:
        app.cache.cleanup()
    return {"roots": [str(output_directory)], "mappings": mappings, "results": results}


def main():
    try:
        result = export_images(json.load(sys.stdin))
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        # Exception paths are intentionally coarse: paths, key candidates, XML and SQLite details are private.
        print(json.dumps({"error": "ImageExportFailed", "code": "IMAGE_EXPORT_FAILED"}, separators=(",", ":")), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
