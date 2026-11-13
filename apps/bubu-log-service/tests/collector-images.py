"""Synthetic tests for the exact offline WeChat image export adapter.

Run with the repository-approved wechat-cli Python.  These fixtures contain no
real account configuration, key values, databases or private media.
"""
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from Crypto.Cipher import AES


SCRIPTS_DIR = pathlib.Path(__file__).parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
spec = importlib.util.spec_from_file_location("bubu_images", SCRIPTS_DIR / "collector-wechat-images.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def pkcs7(data):
    padding = 16 - len(data) % 16
    return data + bytes([padding]) * padding


def encrypt_v2(plain, aes_key, xor_key):
    # Exercise the exact-extra-block split: 16 AES bytes plus one XOR byte.
    aes_part, xor_part = plain[:16], plain[16:]
    header = bytes.fromhex("070856320807") + len(aes_part).to_bytes(4, "little") + len(xor_part).to_bytes(4, "little") + b"\0"
    encrypted = AES.new(aes_key, AES.MODE_ECB).encrypt(pkcs7(aes_part))
    return header + encrypted + bytes(byte ^ xor_key for byte in xor_part)


def encrypt_v2_split(plain, aes_key, xor_key, aes_size, xor_size):
    """Encrypt with an explicit plaintext middle and XOR tail length."""
    aes_part = plain[:aes_size]
    tail_start = len(plain) - xor_size
    middle = plain[aes_size:tail_start]
    xor_part = plain[tail_start:]
    header = bytes.fromhex("070856320807") + aes_size.to_bytes(4, "little") + xor_size.to_bytes(4, "little") + b"\0"
    encrypted = AES.new(aes_key, AES.MODE_ECB).encrypt(pkcs7(aes_part))
    return header + encrypted + middle + bytes(byte ^ xor_key for byte in xor_part)


class SyntheticImageExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bubu-wechat-images-")
        self.root = pathlib.Path(self.temp.name).resolve()
        self.account = "wxid_friend_suffix"
        self.chat = "synthetic-group@chatroom"
        self.table = "Msg_" + hashlib.md5(self.chat.encode()).hexdigest()
        self.seconds = 1792713602
        self.sent_at = datetime.fromtimestamp(self.seconds, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        self.month = datetime.fromtimestamp(self.seconds, adapter.ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")
        self.dir1 = hashlib.md5(self.chat.encode()).hexdigest()
        self.uin = 424242
        self.raw_wxid = "wxid_friend_suffix"
        self.normalized_wxid = "wxid_friend"
        self.aes_key = hashlib.md5((str(self.uin) + self.normalized_wxid).encode()).hexdigest()[:16].encode("ascii")
        self.xor_key = self.uin & 255
        # Signature-only synthetic media is sufficient here; downstream AttachmentService
        # performs full image validation before treating exported files as valid.
        self.plain = b"\x89PNG\r\n\x1a\n" + b"synthetic-payload"
        assert len(self.plain) == 25
        self.xml_md5 = hashlib.md5(self.plain).hexdigest()
        self.dat_name = self.xml_md5 + "_h.dat"
        self.encrypted = encrypt_v2(self.plain, self.aes_key, self.xor_key)
        self.source = self.make_source()
        self.make_live_fixture()
        self.request = {
            "accountId": self.account,
            "chatId": self.chat,
            "configPath": "unused-synthetic-config",
            "allowLive": True,
            "outputDirectory": str(self.root / "output"),
            "kvcommDirectory": str(self.root / "kvcomm"),
            "messages": [self.source],
        }

    def tearDown(self):
        self.temp.cleanup()

    def make_source(self):
        return self.make_source_for_local_id(7)

    def make_source_for_local_id(self, local_id, xml_md5=None):
        database = "message/message_0.db"
        source = adapter.source_id(self.account, database, self.table, local_id)
        return {
            "sourceId": source,
            "accountId": self.account,
            "groupId": "wechat:" + self.account + ":" + self.chat,
            "chatId": self.chat,
            "databaseId": database,
            "tableName": self.table,
            "localId": local_id,
            "sentAt": self.sent_at,
            "kind": "image",
            "media": [{"sourceId": source, "kind": "image", "state": "unresolved",
                       "fingerprint": "md5:" + (xml_md5 or self.xml_md5), "reason": "synthetic"}],
        }

    def add_live_message(self, encrypted, plain, local_id):
        xml_md5 = hashlib.md5(plain).hexdigest()
        dat_name = xml_md5 + "_h.dat"
        media = self.root / self.account / "msg" / "attach" / self.dir1 / self.month / "Img" / dat_name
        media.write_bytes(encrypted)
        xml = f'sender:\n<msg><img md5="{xml_md5}" aeskey="synthetic-private-aeskey" cdnurl="synthetic-private-url"/></msg>'
        with sqlite3.connect(self.paths["message/message_0.db"]) as conn:
            conn.execute(f"INSERT INTO [{self.table}] VALUES(?,3,?,1,?,0)", (local_id, self.seconds, xml))
        with sqlite3.connect(self.paths["message/message_resource.db"]) as conn:
            conn.execute("INSERT INTO MessageResourceInfo VALUES(1,?, ?,3)", (local_id, self.seconds))
        with sqlite3.connect(self.hardlink_db) as conn:
            conn.execute("INSERT INTO image_hardlink_info_v4 VALUES(?,1,?,?,1,2)", (xml_md5, dat_name, len(plain)))
        return self.make_source_for_local_id(local_id, xml_md5)

    def make_live_fixture(self):
        account_root = self.root / self.account
        db_dir = account_root / "db"
        db_dir.mkdir(parents=True)
        source_db = db_dir / "decrypted-message-0.db"
        resource_db = db_dir / "decrypted-resource.db"
        raw_hardlink_db = db_dir / "hardlink" / "hardlink.db"
        raw_hardlink_db.parent.mkdir(parents=True)
        raw_hardlink_db.write_bytes(b"synthetic-encrypted-hardlink-database")
        hardlink_db = self.root / "decrypted-hardlink.db"
        media = account_root / "msg" / "attach" / self.dir1 / self.month / "Img" / self.dat_name
        media.parent.mkdir(parents=True)
        media.write_bytes(self.encrypted)
        xml = f'sender:\n<msg><img md5="{self.xml_md5}" aeskey="synthetic-private-aeskey" cdnurl="synthetic-private-url"/></msg>'
        with sqlite3.connect(source_db) as conn:
            conn.execute(f"CREATE TABLE [{self.table}](local_id INTEGER PRIMARY KEY,local_type INTEGER,create_time INTEGER,real_sender_id INTEGER,message_content BLOB,WCDB_CT_message_content INTEGER)")
            conn.execute(f"INSERT INTO [{self.table}] VALUES(7,3,?,1,?,0)", (self.seconds, xml))
        with sqlite3.connect(resource_db) as conn:
            conn.execute("CREATE TABLE ChatName2Id(user_name TEXT)")
            conn.execute("INSERT INTO ChatName2Id VALUES (?)", (self.chat,))
            conn.execute("CREATE TABLE MessageResourceInfo(chat_id INTEGER,message_local_id INTEGER,message_create_time INTEGER,message_local_type INTEGER)")
            conn.execute("INSERT INTO MessageResourceInfo VALUES(1,7,?,3)", (self.seconds,))
        with sqlite3.connect(hardlink_db) as conn:
            conn.execute("CREATE TABLE dir2id(username TEXT)")
            conn.execute("INSERT INTO dir2id VALUES (?)", (self.dir1,))
            conn.execute("INSERT INTO dir2id VALUES (?)", (self.month,))
            conn.execute("CREATE TABLE image_hardlink_info_v4(md5 TEXT,type INTEGER,file_name TEXT,file_size INTEGER,dir1 INTEGER,dir2 INTEGER)")
            conn.execute("INSERT INTO image_hardlink_info_v4 VALUES(?,1,?,?,1,2)", (self.xml_md5, self.dat_name, len(self.plain)))
        kvcomm = self.root / "kvcomm"
        kvcomm.mkdir()
        (kvcomm / "key_424242_123_456.statistic").write_text("private candidate value", encoding="ascii")
        self.paths = {"message/message_0.db": source_db, "message/message_resource.db": resource_db,
                      "hardlink/hardlink.db": hardlink_db}
        self.db_dir = db_dir
        self.raw_hardlink_db = raw_hardlink_db
        self.hardlink_db = hardlink_db

    def live_context(self, account_name=None):
        class FakeCache:
            def __init__(fake):
                fake.get_keys = []
                fake.cleaned = False

            def get(fake, key):
                fake.get_keys.append(key)
                return self.paths.get(key)

            def cleanup(fake):
                fake.cleaned = True

        cache = FakeCache()

        class FakeAppContext:
            def __init__(fake, config_path):
                fake.db_dir = self.root / (account_name or self.account) / "db"
                fake.cache = cache

        return patch.dict(sys.modules, {"wechat_cli.core.context": SimpleNamespace(AppContext=FakeAppContext)}), cache

    def test_v2_roundtrip_and_exact_export(self):
        self.assertEqual(adapter.decode_v2(self.encrypted, self.xor_key, self.aes_key), self.plain)
        context, cache = self.live_context()
        with context:
            result = adapter.export_images(self.request)
        self.assertTrue(cache.cleaned)
        self.assertEqual(cache.get_keys, ["message/message_resource.db", "message/message_0.db", "hardlink/hardlink.db"])
        output = self.root / "output"
        file = output / (self.xml_md5 + ".png")
        self.assertEqual(result["roots"], [str(output)])
        self.assertEqual(result["mappings"], [{"sourceId": self.source["sourceId"], "index": 0, "path": str(file),
                                                "sha256": hashlib.sha256(self.plain).hexdigest()}])
        self.assertEqual(result["results"], [{"sourceId": self.source["sourceId"], "index": 0, "status": "exported",
                                               "xmlMd5": self.xml_md5, "decodedMd5": self.xml_md5,
                                               "rawByteLength": len(self.plain), "sourceFormat": "png",
                                               "transformed": False,
                                               "outputSha256": hashlib.sha256(self.plain).hexdigest(),
                                               "byteLength": len(self.plain)}])
        self.assertEqual(file.read_bytes(), self.plain)
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        serialized = json.dumps(result)
        for private in (str(self.uin), self.raw_wxid, self.aes_key.decode(), "synthetic-private-aeskey", "synthetic-private-url"):
            self.assertNotIn(private, serialized)

    def test_hardlink_is_obtained_from_cache_not_raw_storage(self):
        original_connect = adapter.sqlite3.connect

        def guarded_connect(target, *args, **kwargs):
            if isinstance(target, str) and target.startswith(self.raw_hardlink_db.as_uri()):
                raise AssertionError("raw encrypted hardlink database was opened")
            return original_connect(target, *args, **kwargs)

        context, cache = self.live_context()
        with patch.object(adapter.sqlite3, "connect", guarded_connect), context:
            result = adapter.export_images(self.request)
        self.assertEqual(result["results"][0]["status"], "exported")
        self.assertEqual(cache.get_keys[-1], "hardlink/hardlink.db")
        self.assertEqual(self.raw_hardlink_db.read_bytes(), b"synthetic-encrypted-hardlink-database")

    def test_decode_rejects_wrong_keys_hashes_and_lengths(self):
        wrong_aes = b"0" * 16
        with self.assertRaisesRegex(ValueError, "IMAGE_DECODE_FAILED"):
            adapter.decode_v2(self.encrypted, self.xor_key, wrong_aes)
        for changed in (self.encrypted[:-1], self.encrypted[:15], self.encrypted[:-17]):
            with self.assertRaisesRegex(ValueError, "IMAGE_DECODE_FAILED"):
                adapter.decode_v2(changed, self.xor_key, self.aes_key)
        record = {"xmlMd5": "0" * 32, "byteLength": len(self.plain) + 1}
        with self.assertRaisesRegex(ValueError, "IMAGE_VERIFICATION_FAILED"):
            adapter.decoded_record(record, self.encrypted, self.xor_key, self.aes_key)

    def test_wrong_xor_is_detected_by_verified_record_not_raw_decode(self):
        wrong = adapter.decode_v2(self.encrypted, self.xor_key ^ 1, self.aes_key)
        self.assertNotEqual(wrong, self.plain)
        record = {"xmlMd5": self.xml_md5, "byteLength": len(self.plain)}
        with self.assertRaisesRegex(ValueError, "IMAGE_VERIFICATION_FAILED"):
            adapter.decoded_record(record, self.encrypted, self.xor_key ^ 1, self.aes_key)

    def test_decode_v2_supports_plaintext_middle_and_empty_xor_tail(self):
        middle_data = b"\x89PNG\r\n\x1a\nmiddle-body-123456789"
        middle_encrypted = encrypt_v2_split(middle_data, self.aes_key, self.xor_key, 16, 4)
        self.assertEqual(adapter.decode_v2(middle_encrypted, self.xor_key, self.aes_key), middle_data)

        xor0_data = b"\x89PNG\r\n\x1a\nplaintext-middle"
        xor0_encrypted = encrypt_v2_split(xor0_data, self.aes_key, self.xor_key, 16, 0)
        self.assertEqual(adapter.decode_v2(xor0_encrypted, self.xor_key, self.aes_key), xor0_data)

    def test_kvcomm_candidates_use_request_account_not_filename_suffix(self):
        directory = self.root / "kvcomm"
        expected = {(self.aes_key, self.xor_key)}
        self.assertEqual(set(adapter.key_candidates(directory, self.account)), expected)
        other_aes = hashlib.md5(b"424242wxid_other").hexdigest()[:16].encode("ascii")
        self.assertEqual(set(adapter.key_candidates(directory, "wxid_other_suffix")), {(other_aes, self.xor_key)})
        with self.assertRaisesRegex(ValueError, "INVALID_KEY_CANDIDATE"):
            adapter.key_candidates(directory, "synthetic-invalid-account")

        boundary = self.root / "boundary-keys"
        boundary.mkdir()
        for uin in range(1, 102):
            (boundary / f"key_{uin}_filename-suffix.statistic").write_text("private", encoding="ascii")
        with self.assertRaisesRegex(ValueError, "TOO_MANY_KEY_CANDIDATES"):
            adapter.key_candidates(boundary, self.account)

    def test_ambiguous_key_candidates_fail_closed(self):
        other_uin = 434343
        other_aes = hashlib.md5((str(other_uin) + self.normalized_wxid).encode()).hexdigest()[:16].encode("ascii")
        other_plain = b"\x89PNG\r\n\x1a\nother-candidate"
        other_encrypted = encrypt_v2(other_plain, other_aes, other_uin & 255)
        first = {"xmlMd5": self.xml_md5, "byteLength": len(self.plain), "encrypted": self.encrypted}
        second = {"xmlMd5": hashlib.md5(other_plain).hexdigest(), "byteLength": len(other_plain),
                  "encrypted": other_encrypted}
        candidates = [(self.aes_key, self.xor_key), (other_aes, other_uin & 255)]
        with self.assertRaisesRegex(ValueError, "IMAGE_KEY_SELECTION_FAILED"):
            adapter.select_key(candidates, [first, second])

    def test_missing_media_does_not_prevent_other_export(self):
        (self.root / self.account / "msg" / "attach" / self.dir1 / self.month / "Img" / self.dat_name).unlink()
        good_plain = b"\x89PNG\r\n\x1a\nsecond-image"
        good_source = self.add_live_message(encrypt_v2(good_plain, self.aes_key, self.xor_key), good_plain, 8)
        request = {**self.request, "messages": [self.source, good_source]}
        context, _ = self.live_context()
        with context:
            result = adapter.export_images(request)
        self.assertEqual(result["results"][0]["status"], "unavailable")
        self.assertEqual(result["results"][0]["reason"], "MEDIA_UNAVAILABLE")
        self.assertEqual(result["results"][1]["status"], "exported")
        self.assertEqual(len(result["mappings"]), 1)
        self.assertTrue((self.root / "output" / (hashlib.md5(good_plain).hexdigest() + ".png")).is_file())

    def test_ambiguous_key_selection_reason_is_preserved_for_all_images(self):
        other_uin = 434343
        other_aes = hashlib.md5((str(other_uin) + self.normalized_wxid).encode()).hexdigest()[:16].encode("ascii")
        other_plain = b"\x89PNG\r\n\x1a\nsecond-candidate"
        other_source = self.add_live_message(
            encrypt_v2(other_plain, other_aes, other_uin & 255), other_plain, 8)
        candidates = {(self.aes_key, self.xor_key), (other_aes, other_uin & 255)}
        request = {**self.request, "messages": [self.source, other_source]}
        context, _ = self.live_context()
        with patch.object(adapter, "key_candidates", return_value=candidates), context:
            result = adapter.export_images(request)
        self.assertEqual(result["mappings"], [])
        self.assertEqual([entry["reason"] for entry in result["results"]],
                         ["IMAGE_KEY_SELECTION_FAILED", "IMAGE_KEY_SELECTION_FAILED"])
        self.assertEqual(list((self.root / "output").iterdir()), [])

    def test_wxgf_export_writes_verified_raw_and_converted_png(self):
        raw = b"wxgf-synthetic-frame"
        encrypted = encrypt_v2(raw, self.aes_key, self.xor_key)
        source = self.add_live_message(encrypted, raw, 8)
        request = {**self.request, "messages": [source], "ffmpeg": "/synthetic/ffmpeg", "ffprobe": "/synthetic/ffprobe"}
        png = b"\x89PNG\r\n\x1a\nconverted-png"
        context, _ = self.live_context()
        with patch("collector_wxgf.decode_wxgf", return_value=png) as decoder, context:
            result = adapter.export_images(request)
        decoder.assert_called_once_with(raw, "/synthetic/ffmpeg", "/synthetic/ffprobe")
        raw_file = self.root / "output" / (hashlib.md5(raw).hexdigest() + ".wxgf")
        png_file = self.root / "output" / (hashlib.md5(raw).hexdigest() + ".png")
        self.assertEqual(raw_file.read_bytes(), raw)
        self.assertEqual(png_file.read_bytes(), png)
        self.assertEqual(raw_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(png_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(result["mappings"], [{"sourceId": source["sourceId"], "index": 0, "path": str(png_file),
                                                "sha256": hashlib.sha256(png).hexdigest()}])
        self.assertEqual(result["results"], [{
            "sourceId": source["sourceId"], "index": 0, "status": "exported",
            "xmlMd5": hashlib.md5(raw).hexdigest(), "decodedMd5": hashlib.md5(raw).hexdigest(),
            "rawByteLength": len(raw), "sourceFormat": "wxgf", "transformed": True,
            "outputSha256": hashlib.sha256(png).hexdigest(), "byteLength": len(png),
        }])

    def test_wxgf_requires_both_explicit_tools_without_decoding(self):
        raw = b"wxgf-synthetic-frame"
        encrypted = encrypt_v2(raw, self.aes_key, self.xor_key)
        source = self.add_live_message(encrypted, raw, 8)
        for tools in ({}, {"ffmpeg": "/synthetic/ffmpeg"}, {"ffprobe": "/synthetic/ffprobe"}):
            request = {**self.request, "messages": [source], **tools}
            context, _ = self.live_context()
            with patch("collector_wxgf.decode_wxgf") as decoder, context:
                result = adapter.export_images(request)
            decoder.assert_not_called()
            self.assertEqual(result["mappings"], [])
            self.assertEqual(result["results"][0]["status"], "unavailable")
            self.assertEqual(result["results"][0]["reason"], "WXGF_TOOLS_REQUIRED")
        self.assertEqual(list((self.root / "output").iterdir()), [])

    def test_one_bad_wxgf_does_not_prevent_good_export(self):
        good_raw = b"wxgf-good-synthetic-frame"
        bad_raw = b"wxgf-bad-synthetic-frame"
        bad_source = self.add_live_message(encrypt_v2(bad_raw, self.aes_key, self.xor_key), bad_raw, 8)
        good_source = self.add_live_message(encrypt_v2(good_raw, self.aes_key, self.xor_key), good_raw, 9)
        request = {**self.request, "messages": [bad_source, good_source],
                   "ffmpeg": "/synthetic/ffmpeg", "ffprobe": "/synthetic/ffprobe"}
        good_png = b"\x89PNG\r\n\x1a\ngood-png"
        import collector_wxgf

        def decode(data, _ffmpeg, _ffprobe):
            if data == good_raw:
                return good_png
            raise collector_wxgf.WxgfError("WXGF_DECODE_FAILED")

        context, _ = self.live_context()
        with patch("collector_wxgf.decode_wxgf", side_effect=decode), context:
            result = adapter.export_images(request)
        self.assertEqual(result["results"][0]["status"], "unavailable")
        self.assertEqual(result["results"][0]["reason"], "WXGF_DECODE_FAILED")
        self.assertEqual(result["results"][1]["status"], "exported")
        self.assertEqual(len(result["mappings"]), 1)
        good_md5 = hashlib.md5(good_raw).hexdigest()
        self.assertTrue((self.root / "output" / (good_md5 + ".png")).is_file())
        self.assertFalse((self.root / "output" / (hashlib.md5(bad_raw).hexdigest() + ".wxgf")).exists())

    def test_wxgf_decoder_is_not_reached_when_raw_hash_is_wrong(self):
        raw = b"wxgf-synthetic-frame"
        encrypted = encrypt_v2(raw, self.aes_key, self.xor_key)
        record = {"xmlMd5": "0" * 32, "byteLength": len(raw)}
        with patch("collector_wxgf.decode_wxgf") as decoder:
            with self.assertRaisesRegex(ValueError, "IMAGE_VERIFICATION_FAILED"):
                adapter.decoded_record(record, encrypted, self.xor_key, self.aes_key)
            decoder.assert_not_called()

    def test_rejects_unsafe_hardlink_names_and_symlink_paths(self):
        with sqlite3.connect(self.hardlink_db) as conn:
            conn.execute("UPDATE image_hardlink_info_v4 SET file_name=?", ("../../" + self.dat_name,))
        context, _ = self.live_context()
        with context:
            result = adapter.export_images(self.request)
        self.assertEqual(result["mappings"], [])
        self.assertEqual(result["results"][0]["status"], "unavailable")
        self.assertEqual(result["results"][0]["reason"], "UNSAFE_HARDLINK_NAME")

    def test_rejects_symlinked_dat_without_writing(self):
        media = self.root / self.account / "msg" / "attach" / self.dir1 / self.month / "Img" / self.dat_name
        outside = self.root / "outside.dat"
        outside.write_bytes(self.encrypted)
        media.unlink()
        media.symlink_to(outside)
        context, _ = self.live_context()
        with context:
            result = adapter.export_images(self.request)
        self.assertEqual(result["mappings"], [])
        self.assertEqual(result["results"][0]["reason"], "MEDIA_PATH_NOT_ALLOWED")
        self.assertEqual(list((self.root / "output").iterdir()), [])

    def test_rejects_source_or_resource_mismatch_and_ambiguity(self):
        source_db = self.paths["message/message_0.db"]
        with sqlite3.connect(source_db) as conn:
            conn.execute(f"UPDATE [{self.table}] SET local_type=1 WHERE local_id=7")
        context, _ = self.live_context()
        with context:
            result = adapter.export_images(self.request)
        self.assertEqual(result["results"][0]["reason"], "SOURCE_ROW_MISMATCH")

    def test_disabled_live_never_loads_context(self):
        request = {**self.request, "allowLive": False}
        with self.assertRaisesRegex(ValueError, "LIVE_IMAGE_EXPORT_DISABLED"):
            adapter.export_images(request)

    def test_account_mismatch_cleans_live_context(self):
        context, cache = self.live_context(account_name="another-account")
        with context, self.assertRaisesRegex(ValueError, "SOURCE_ACCOUNT_MISMATCH"):
            adapter.export_images(self.request)
        self.assertTrue(cache.cleaned)

    def test_cli_failure_has_no_candidate_or_private_material(self):
        wrong_key = hashlib.md5(b"wrong-candidate").hexdigest()[:16].encode("ascii")
        candidates = {(wrong_key, self.xor_key)}
        stdout, stderr = io.StringIO(), io.StringIO()
        context, _ = self.live_context()
        with patch.object(adapter, "key_candidates", return_value=candidates), context, \
             patch.object(sys, "stdin", io.StringIO(json.dumps(self.request))), \
             patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr):
            adapter.main()
        self.assertEqual(stderr.getvalue(), "")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["mappings"], [])
        self.assertEqual(payload["results"][0]["status"], "unavailable")
        self.assertEqual(payload["results"][0]["reason"], "IMAGE_VERIFICATION_FAILED")
        serialized = stdout.getvalue()
        for private in (str(self.uin), self.raw_wxid, self.aes_key.decode(), "synthetic-private-aeskey"):
            self.assertNotIn(private, serialized)


if __name__ == "__main__":
    unittest.main()
