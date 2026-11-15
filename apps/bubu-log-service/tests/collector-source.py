"""Synthetic SQLite only. Run with a Python having installed wechat_cli + zstandard.

PYTHONPATH may point to the already installed wechat_cli pure Python package and
architecture-compatible dependencies; this test never reads its config or keys.
"""
import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import zstandard
import wechat_cli.core as wechat_core

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

    def live_request(self):
        request = {**self.request, "allowLive": True, "configPath": "unused-synthetic-config"}
        request.pop("fixtureManifest", None)
        return request

    def live_context(self, paths, decrypted_dir=None, display_name_fn=lambda username, names: None, contacts=None):
        irrelevant_key = "message/biz_message_0.db"

        class FakeCache:
            def __init__(self):
                self.get_keys = []
                self.cleaned = False

            def get(self, key):
                self.get_keys.append(key)
                if key == irrelevant_key:
                    raise AssertionError("irrelevant biz database must not be decrypted")
                return paths.get(key)

            def cleanup(self):
                self.cleaned = True

        cache = FakeCache()

        class FakeAppContext:
            def __init__(fake_self, config_path):
                fake_self.db_dir = self.root / "synthetic-account" / "db"
                fake_self.msg_db_keys = [
                    irrelevant_key,
                    "message/message_0.db",
                    "message/message_1.db",
                ]
                fake_self.cache = cache
                fake_self.decrypted_dir = decrypted_dir
                fake_self.display_name_fn = display_name_fn

        contacts = contacts or SimpleNamespace(
            get_contact_names=lambda _cache, _decrypted_dir: {},
            get_contact_detail=lambda _username, _cache, _decrypted_dir: None,
        )
        modules = {
            "wechat_cli.core.context": SimpleNamespace(AppContext=FakeAppContext),
            "wechat_cli.core.contacts": contacts,
        }
        # collector-wechat-source imports messages first, so the parent package is
        # already loaded. Patch its attribute too; sys.modules alone only covers a
        # fresh submodule import and would otherwise leave the real module visible.
        context = ExitStack()
        context.enter_context(patch.dict(sys.modules, modules))
        context.enter_context(patch.object(wechat_core, "contacts", contacts, create=True))
        return context, cache

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
            self.assertNotIn("senderName", text)
            self.assertNotIn("senderAvatarUrl", text)
        self.assertEqual(media["media"][0]["fingerprint"], "md5:0123456789abcdef0123456789abcdef")
        self.assertEqual(media["media"][0]["state"], "unresolved")
        self.assertNotIn("synthetic-media-key", json.dumps(first))
        self.assertNotIn("must never", json.dumps(first))
        again = adapter.read({**self.request, "cursor": first["nextCursor"]})
        self.assertEqual([row["localId"] for row in again["messages"]], [2])
        self.assertFalse(again["hasMore"])
        self.assertEqual(adapter.read({**self.request, "cursor": again["nextCursor"]})["messages"], [])

    def test_synthetic_name_is_optional_and_older_payload_stays_shape_compatible(self):
        avatar = "https://wx.qlogo.cn/mmhead/synthetic/132"
        result = adapter.read({**self.request, "senderNames": {"synthetic-sender": "外婆"},
                               "senderAvatars": {"synthetic-sender": avatar}})
        self.assertEqual(result["messages"][0]["senderName"], "外婆")
        self.assertEqual(result["messages"][0]["senderAvatarUrl"], avatar)
        self.assertEqual(result["messages"][1]["senderId"], "synthetic-sender")
        self.assertEqual(result["messages"][1]["senderName"], "外婆")
        self.assertEqual(result["messages"][1]["senderAvatarUrl"], avatar)
        with self.assertRaisesRegex(ValueError, "INVALID_SENDER_NAMES"):
            adapter.read({**self.request, "senderNames": {"synthetic-sender": ""}})
        for unsafe in ["http://wx.qlogo.cn/mmhead/a/132", "data:image/png;base64,abc",
                       "https://user:secret@wx.qlogo.cn/mmhead/a/132", "file:///tmp/avatar"]:
            with self.assertRaisesRegex(ValueError, "INVALID_SENDER_AVATARS"):
                adapter.read({**self.request, "senderAvatars": {"synthetic-sender": unsafe}})

    def test_live_contact_name_is_used_only_for_included_bound_group_sender(self):
        avatar = "https://thirdwx.qlogo.cn/mmopen/synthetic/132"
        contacts = SimpleNamespace(
            get_contact_names=lambda cache, decrypted_dir: {"synthetic-sender": "新名字"},
            get_contact_detail=lambda username, cache, decrypted_dir: {"avatar": avatar},
        )
        paths = {
            "message/message_0.db": self.databases[0]["path"],
            "message/message_1.db": self.databases[1]["path"],
        }
        context, _ = self.live_context(
            paths,
            decrypted_dir=self.root / "synthetic-account" / "decrypted",
            display_name_fn=lambda username, names: names.get(username),
            contacts=contacts,
        )
        with context:
            result = adapter.read({**self.live_request(), "limit": 500})
        named = [row for row in result["messages"] if row["senderId"] == "synthetic-sender"]
        self.assertEqual(named[0]["senderName"], "新名字")
        self.assertEqual(named[0]["senderAvatarUrl"], avatar)
        self.assertTrue(all("senderName" not in row for row in result["messages"] if row["senderId"] != "synthetic-sender"))

    def test_live_unsafe_or_missing_contact_avatar_is_absent(self):
        paths = {
            "message/message_0.db": self.databases[0]["path"],
            "message/message_1.db": self.databases[1]["path"],
        }
        for avatar in [None, "javascript:alert(1)", "https://evil.example/mmhead/a/132",
                       "https://user:secret@wx.qlogo.cn/mmhead/a/132"]:
            contacts = SimpleNamespace(
                get_contact_names=lambda cache, decrypted_dir: {},
                get_contact_detail=lambda username, cache, decrypted_dir: None if avatar is None else {"avatar": avatar},
            )
            context, _ = self.live_context(paths, contacts=contacts)
            with context:
                result = adapter.read({**self.live_request(), "limit": 500})
            self.assertTrue(all("senderAvatarUrl" not in row for row in result["messages"]))

    def test_contact_lookup_failure_does_not_fail_bound_group_read(self):
        paths = {
            "message/message_0.db": self.databases[0]["path"],
            "message/message_1.db": self.databases[1]["path"],
        }
        context, _ = self.live_context(paths, display_name_fn=lambda username, names: (_ for _ in ()).throw(RuntimeError("synthetic contact failure")))
        with context:
            result = adapter.read({**self.live_request(), "limit": 500})
        self.assertEqual(len(result["messages"]), 4)
        self.assertTrue(all("senderName" not in row for row in result["messages"]))

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

    def test_live_irrelevant_database_is_not_decrypted_and_group_databases_process(self):
        paths = {
            "message/message_0.db": self.databases[0]["path"],
            "message/message_1.db": self.databases[1]["path"],
        }
        context, cache = self.live_context(paths)
        with context:
            result = adapter.read({**self.live_request(), "limit": 500})
        self.assertEqual(cache.get_keys, list(paths))
        self.assertTrue(cache.cleaned)
        self.assertEqual(
            [row["databaseId"] for row in result["messages"]],
            ["message/message_0.db", "message/message_0.db", "message/message_1.db", "message/message_1.db"],
        )

    def test_live_eligible_database_failure_remains_fail_closed(self):
        paths = {"message/message_0.db": None, "message/message_1.db": self.databases[1]["path"]}
        context, cache = self.live_context(paths)
        with context, self.assertRaisesRegex(ValueError, "SOURCE_DATABASE_UNAVAILABLE"):
            adapter.read(self.live_request())
        self.assertEqual(cache.get_keys, ["message/message_0.db"])
        self.assertTrue(cache.cleaned)

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
