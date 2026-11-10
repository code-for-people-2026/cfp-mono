#!/usr/bin/env python3
"""Tests for the bounded WXGF decoder."""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
FFMPEG = os.environ.get("FFMPEG_BIN", "/usr/local/bin/ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "/usr/local/bin/ffprobe")

sys.path.insert(0, str(SCRIPTS))

import collector_wxgf  # noqa: E402


def make_wxgf(hevc: bytes, *, extra_length: int = 0) -> bytes:
    return b"wxgf" + struct.pack(">I", len(hevc) + extra_length) + hevc


def generate_single_frame_hevc() -> bytes:
    command = [
        FFMPEG,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=32x24:d=1",
        "-frames:v",
        "1",
        "-an",
        "-f",
        "hevc",
        "pipe:1",
    ]
    try:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except OSError:
        raise unittest.SkipTest("local ffmpeg cannot generate the synthetic HEVC fixture") from None
    if result.returncode != 0 or not result.stdout:
        raise unittest.SkipTest("local ffmpeg cannot generate the synthetic HEVC fixture")
    return result.stdout


def png_dimensions(png: bytes) -> tuple[int, int]:
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("result is not a PNG")
    return struct.unpack(">II", png[16:24])


class DecodeWxgfTests(unittest.TestCase):
    _hevc: bytes | None = None

    @classmethod
    def hevc(cls) -> bytes:
        if cls._hevc is None:
            cls._hevc = generate_single_frame_hevc()
        return cls._hevc

    def test_rejects_non_absolute_executable(self) -> None:
        with self.assertRaises(collector_wxgf.WxgfError) as raised:
            collector_wxgf.decode_wxgf(b"wxgf", "ffmpeg", FFPROBE)
        self.assertEqual(str(raised.exception), "WXGF_EXECUTABLE")

    def test_rejects_invalid_header(self) -> None:
        with self.assertRaises(collector_wxgf.WxgfError) as raised:
            collector_wxgf.decode_wxgf(b"notwxgf", FFMPEG, FFPROBE)
        self.assertEqual(str(raised.exception), "WXGF_HEADER_INVALID")

    def test_decodes_synthetic_single_frame(self) -> None:
        png = collector_wxgf.decode_wxgf(make_wxgf(self.hevc()), FFMPEG, FFPROBE)
        self.assertEqual(png_dimensions(png), (32, 24))

    def test_rejects_truncated_partition(self) -> None:
        with self.assertRaises(collector_wxgf.WxgfError) as raised:
            collector_wxgf.decode_wxgf(make_wxgf(self.hevc(), extra_length=1), FFMPEG, FFPROBE)
        self.assertEqual(str(raised.exception), "WXGF_PARTITION_INVALID")

    def test_rejects_second_partition(self) -> None:
        hevc = self.hevc()
        wrapped = make_wxgf(hevc) + hevc
        with self.assertRaises(collector_wxgf.WxgfError) as raised:
            collector_wxgf.decode_wxgf(wrapped, FFMPEG, FFPROBE)
        self.assertEqual(str(raised.exception), "WXGF_MULTIPLE_PARTITIONS")

    def test_rejects_mocked_animated_stream(self) -> None:
        stream = {
            "codec_type": "video",
            "codec_name": "hevc",
            "width": 32,
            "height": 24,
            "nb_read_frames": 2,
        }
        probe_result = json.dumps({"streams": [stream]}).encode()
        wrapped = make_wxgf(b"\x00\x00\x00\x01\x40\x01" + b"\x00" * 16)
        with mock.patch.object(
            collector_wxgf.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, stdout=probe_result),
        ):
            with self.assertRaises(collector_wxgf.WxgfError) as raised:
                collector_wxgf.decode_wxgf(wrapped, FFMPEG, FFPROBE)
        self.assertEqual(str(raised.exception), "WXGF_STREAM_INVALID")


if __name__ == "__main__":
    unittest.main()
