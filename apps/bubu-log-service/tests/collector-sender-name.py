"""Unit tests for sender-name selection; no real contact store is read."""
import importlib.util
import pathlib
import unittest
from types import SimpleNamespace


spec = importlib.util.spec_from_file_location(
    "bubu_source",
    pathlib.Path(__file__).parents[1] / "scripts/collector-wechat-source.py",
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class SenderNameTest(unittest.TestCase):
    @staticmethod
    def app(display_name):
        return SimpleNamespace(display_name_fn=lambda _sender_id, _names: display_name)

    def test_synthetic_name_remains_first_override(self):
        app = self.app("fallback-name")
        names = {"sender-id": "captured-name"}
        synthetic = {"sender-id": "synthetic-name"}

        self.assertEqual(adapter.sender_name("sender-id", synthetic, names, app), "synthetic-name")

    def test_captured_self_name_wins_even_when_display_fn_returns_me(self):
        app = self.app("me")
        names = {"sender-id": "Actual Caregiver"}

        self.assertEqual(adapter.sender_name("sender-id", {}, names, app), "Actual Caregiver")

    def test_unknown_self_display_me_is_omitted(self):
        app = self.app("me")

        self.assertIsNone(adapter.sender_name("sender-id", {}, {}, app))

    def test_normal_captured_name_is_preserved(self):
        app = self.app("fallback-name")
        names = {"sender-id": "Normal Name"}

        self.assertEqual(adapter.sender_name("sender-id", {}, names, app), "Normal Name")

    def test_normal_fallback_name_is_preserved(self):
        app = self.app("Fallback Name")

        self.assertEqual(adapter.sender_name("sender-id", {}, {}, app), "Fallback Name")

    def test_fallback_raw_sender_id_is_not_fabricated_as_name(self):
        sender_id = "sender-id"
        app = SimpleNamespace(display_name_fn=lambda sender, _names: sender)

        self.assertIsNone(adapter.sender_name(sender_id, {}, {}, app))

    def test_oversized_captured_name_is_rejected(self):
        app = self.app("me")
        names = {"sender-id": "x" * 201}

        self.assertIsNone(adapter.sender_name("sender-id", {}, names, app))


if __name__ == "__main__":
    unittest.main()
