"""Synthetic SQLite only. Run with a Python having installed wechat_cli + zstandard.

PYTHONPATH may point to the already installed wechat_cli pure Python package and
architecture-compatible dependencies; this test never reads its config or keys.
"""
import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import zstandard

spec = importlib.util.spec_from_file_location("bubu_source", pathlib.Path(__file__).parents[1] / "scripts/collector-wechat-source.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class SyntheticSourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bubu-wechat-fixture-")
        self.root = pathlib.Path(self.temp.name)
        self.chat = "synthetic-group@chatroom"
        self.table = "Msg_" + hashlib.md5(self.chat.encode()).hexdigest()
        other = "Msg_" + hashlib.md5(b"unbound-group@chatroom").hexdigest()
        self.databases = []
        for index in range(2):
            path = self.root / ("message_" + str(index) + ".db")
            self.databases.append({"databaseId": "message/" + path.name, "path": str(path)})
            with sqlite3.connect(path) as conn:
                conn.execute("CREATE TABLE Name2Id(user_name TEXT)")
                conn.execute("INSERT INTO Name2Id VALUES ('synthetic-sender')")
                for table in [self.table, other]:
                    conn.execute(f"CREATE TABLE [{table}](local_id INTEGER PRIMARY KEY,local_type INTEGER,create_time INTEGER,real_sender_id INTEGER,message_content BLOB,WCDB_CT_message_content INTEGER)")
                conn.execute(f"INSERT INTO [{other}] VALUES(1,1,1792713601,1,'must never read unbound group',0)")
                text = "synthetic-sender:\n奶粉泡好120ml，喝了90ml"
                conn.execute(f"INSERT INTO [{self.table}] VALUES(1,1,1792713601,1,?,4)", (zstandard.ZstdCompressor().compress(text.encode()),))
                conn.execute(f"INSERT INTO [{self.table}] VALUES(2,3,1792713602,1,?,0)", ('synthetic-sender:\n<msg><img md5="0123456789abcdef0123456789abcdef" aeskey="synthetic-media-key" /></msg>',))
        self.manifest = self.root / "fixture.json"
        self.manifest.write_text(json.dumps({"fixture": True, "accountId": "synthetic-account", "databases": self.databases}))
        self.request = {"accountId": "synthetic-account", "chatId": self.chat, "fixtureManifest": str(self.manifest), "cursor": {}, "limit": 3}

    def tearDown(self):
        self.temp.cleanup()

    def test_identity_seconds_sender_media_and_resume(self):
        with patch.object(adapter.wc, "_resolve_media_path", side_effect=AssertionError("must not guess media")):
            first = adapter.read(self.request)
            self.assertEqual(len(first["messages"]), 3)
            self.assertTrue(first["hasMore"])
            text, media, second_db_text = first["messages"]
            self.assertNotEqual(text["sourceId"], second_db_text["sourceId"])
            self.assertEqual(text["sentAt"], "2026-10-23T00:00:01Z")
            self.assertEqual(text["senderId"], "synthetic-sender")
            self.assertEqual(text["text"], "奶粉泡好120ml，喝了90ml")
            self.assertEqual(media["media"][0]["fingerprint"], "md5:0123456789abcdef0123456789abcdef")
            self.assertEqual(media["media"][0]["state"], "unresolved")
            self.assertNotIn("synthetic-media-key", json.dumps(first))
            self.assertNotIn("must never", json.dumps(first))
            again = adapter.read({**self.request, "cursor": first["nextCursor"]})
            self.assertEqual([row["localId"] for row in again["messages"]], [2])
            self.assertFalse(again["hasMore"])
            self.assertEqual(adapter.read({**self.request, "cursor": again["nextCursor"]})["messages"], [])

    def test_local_id_cursor_does_not_drop_late_old_timestamp(self):
        page = adapter.read({**self.request, "limit": 500})
        with sqlite3.connect(self.databases[0]["path"]) as conn:
            conn.execute(f"INSERT INTO [{self.table}] VALUES(3,1,1792713500,1,'late old message',0)")
        later = adapter.read({**self.request, "cursor": page["nextCursor"]})
        self.assertEqual(later["messages"][0]["text"], "late old message")

    def test_backfill_and_stable_reopened_sources(self):
        request = {**self.request, "limit": 500, "range": {"from": "2026-10-23T00:00:02Z", "to": "2026-10-23T00:00:02Z"}}
        self.assertEqual([row["localId"] for row in adapter.read(request)["messages"]], [2, 2])
        self.assertEqual(adapter.read(request), adapter.read(request))
        changed = dict(self.request, accountId="another-account")
        with self.assertRaisesRegex(ValueError, "INVALID_FIXTURE_MANIFEST"):
            adapter.read(changed)

    def test_disabled_live_and_not_group_never_load_context(self):
        with self.assertRaisesRegex(ValueError, "LIVE_SOURCE_DISABLED"):
            adapter.read({"accountId": "synthetic-account", "chatId": self.chat})
        with self.assertRaisesRegex(ValueError, "BOUND_GROUP_REQUIRED"):
            adapter.read({**self.request, "chatId": "some-person"})

    def test_corrupt_message_or_missing_database_does_not_advance_cursor(self):
        with sqlite3.connect(self.databases[0]["path"]) as conn:
            conn.execute(f"INSERT INTO [{self.table}] VALUES(3,1,1792713603,1,?,4)", (b"not zstd",))
        with self.assertRaisesRegex(ValueError, "MESSAGE_DECOMPRESSION_FAILED"):
            adapter.read({**self.request, "limit": 500})
        pathlib.Path(self.databases[0]["path"]).unlink()
        with self.assertRaises(sqlite3.OperationalError):
            adapter.read(self.request)


if __name__ == "__main__":
    unittest.main()
