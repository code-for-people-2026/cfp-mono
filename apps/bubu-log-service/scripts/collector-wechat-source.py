#!/usr/bin/env python3
"""Bound-group source adapter. stdin/stdout JSON; no default account discovery.

Imports parsing helpers from the installed wechat_cli without changing that package.
Unlike its history formatter, this preserves table/local_id, seconds and sender IDs.
Fixture mode never constructs AppContext or reads wechat-cli config/keys.
"""
import hashlib
import json
import pathlib
import re
import sqlite3
import sys
from datetime import datetime, timezone

from wechat_cli.core import messages as wc


def require(value, pattern, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError(label)
    return value


def source_id(account, database, table, local_id):
    data = json.dumps(["wechat", account, database, table, local_id], separators=(",", ":"), ensure_ascii=False)
    return "wechat:" + hashlib.sha256(data.encode()).hexdigest()


def database_id(value):
    return require(value.replace("\\", "/"), r"message/message_\d+\.db", "INVALID_DATABASE_ID")


def streams(request, account):
    if request.get("fixtureManifest"):
        # Deliberately explicit: fixtures cannot accidentally invoke AppContext.
        manifest = json.loads(pathlib.Path(request["fixtureManifest"]).read_text())
        if manifest.get("fixture") is not True or manifest.get("accountId") != account:
            raise ValueError("INVALID_FIXTURE_MANIFEST")
        return [(database_id(item["databaseId"]), pathlib.Path(item["path"]).resolve()) for item in manifest["databases"]], None
    if request.get("allowLive") is not True or not request.get("configPath"):
        raise ValueError("LIVE_SOURCE_DISABLED")
    from wechat_cli.core.context import AppContext
    app = AppContext(config_path=request["configPath"])
    if pathlib.Path(app.db_dir).resolve().parent.name != account:
        app.cache.cleanup()
        raise ValueError("SOURCE_ACCOUNT_MISMATCH")
    result = []
    for key in app.msg_db_keys:
        decrypted = app.cache.get(key)
        if not decrypted:
            app.cache.cleanup()
            raise ValueError("SOURCE_DATABASE_UNAVAILABLE")
        result.append((database_id(key), pathlib.Path(decrypted).resolve()))
    return result, app


def media_for(source, kind, text):
    if kind not in ("image", "voice", "video", "file"):
        return []
    media = {"sourceId": source, "kind": kind, "state": "unresolved",
             "reason": "Exact message media bytes are not available; do not guess a neighbouring file."}
    root = wc._parse_xml_root(text)
    if root is not None:
        for node in root.iter():
            md5 = node.attrib.get("md5", "")
            if re.fullmatch(r"[0-9a-fA-F]{32}", md5):
                media["fingerprint"] = "md5:" + md5.lower()
                break
    # wechat_cli._resolve_media_path picks the first monthly file, so never use it
    # as exact message evidence or upload an unrelated family's photograph.
    return [media]


def read(request):
    account = require(request.get("accountId"), r"[\w.-]{1,128}", "INVALID_ACCOUNT")
    chat = require(request.get("chatId"), r"[\w.-]{1,160}@chatroom", "BOUND_GROUP_REQUIRED")
    group = "wechat:" + account + ":" + chat
    table = "Msg_" + hashlib.md5(chat.encode()).hexdigest()
    if not wc._is_safe_msg_table_name(table):
        raise ValueError("INVALID_TABLE")
    limit = request.get("limit", 100)
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 500:
        raise ValueError("INVALID_LIMIT")
    cursor = request.get("cursor", {})
    if not isinstance(cursor, dict) or any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in cursor.values()):
        raise ValueError("INVALID_CURSOR")
    start = end = None
    if request.get("range"):
        start = datetime.fromisoformat(request["range"]["from"].replace("Z", "+00:00")).timestamp()
        end = datetime.fromisoformat(request["range"]["to"].replace("Z", "+00:00")).timestamp()
        if start > end:
            raise ValueError("INVALID_RANGE")
    sources, app = streams(request, account)
    output = []
    next_cursor = dict(cursor)
    has_more = False
    try:
        for db_id, path in sorted(sources):
            stream_id = db_id + ":" + table
            # Read-only SQLite URI, including in fixture mode.
            with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as conn:
                exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
                if not exists:
                    continue
                names = wc._load_name2id_maps(conn)
                clauses, params = wc._build_message_filters(start, end)
                clauses.append("local_id > ?")
                params.append(cursor.get(stream_id, 0))
                remaining = limit - len(output)
                rows = conn.execute(
                    f"SELECT local_id,local_type,create_time,real_sender_id,message_content,WCDB_CT_message_content FROM [{table}] WHERE {' AND '.join(clauses)} ORDER BY local_id ASC LIMIT ?",
                    (*params, remaining + 1),
                ).fetchall()
                if len(rows) > remaining:
                    has_more = True
                for local_id, local_type, ts, sender, content, ct in rows[:remaining]:
                    text = wc.decompress_content(content, ct)
                    if text is None:
                        raise ValueError("MESSAGE_DECOMPRESSION_FAILED")
                    content_sender, text = wc._parse_message_content(text, local_type, True)
                    mapped_sender = names.get(sender)
                    sender_id = mapped_sender if mapped_sender and mapped_sender != chat else content_sender or None
                    kind = {1: "text", 3: "image", 34: "voice", 43: "video", 49: "file", 10000: "system", 10002: "system"}.get(local_type & 0xFFFFFFFF, "other")
                    if (local_type & 0xFFFFFFFF) == 49:
                        root = wc._parse_xml_root(text)
                        app_type = root.findtext(".//appmsg/type") if root is not None else None
                        if app_type == "57":
                            kind = "text"
                            text = wc._format_app_message_text(text, local_type, True, chat, chat, {}, lambda username, _names: username) or "[quoted message unavailable]"
                        elif app_type != "6":
                            kind = "other"
                    source = source_id(account, db_id, table, local_id)
                    media = media_for(source, kind, text)
                    # Media XML can contain CDN credentials. Retain exact source
                    # fingerprints, never hand those credentials to the Agent.
                    if kind in ("image", "voice", "video", "file"):
                        text = "[" + kind + "]"
                    output.append({"sourceId": source, "accountId": account, "groupId": group,
                                   "chatId": chat, "databaseId": db_id, "tableName": table,
                                   "localId": local_id, "sentAt": datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                                   "senderId": sender_id, "kind": kind, "text": text,
                                   "media": media})
                    next_cursor[stream_id] = local_id
        return {"messages": output, "nextCursor": next_cursor, "hasMore": has_more}
    finally:
        if app:
            app.cache.cleanup()


if __name__ == "__main__":
    try:
        print(json.dumps(read(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        # Avoid database paths, source content, config or key material in logs.
        print(json.dumps({"error": type(error).__name__, "code": "SOURCE_READ_FAILED"}), file=sys.stderr)
        sys.exit(1)
