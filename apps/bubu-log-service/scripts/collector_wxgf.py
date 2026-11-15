"""Bounded WXGF single-frame decoder.

The input format is intentionally treated as untrusted.  Only an elementary
HEVC stream is passed to the explicitly supplied ffmpeg tools, and the decoded
result is validated before it is returned.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import zlib
from typing import Any


MAX_INPUT_SIZE = 10 * 1024 * 1024
MAX_OUTPUT_SIZE = 10 * 1024 * 1024
MAX_NALS = 4096
MAX_DIMENSION = 4096
MAX_PIXELS = 16_000_000
PROCESS_TIMEOUT_SECONDS = 10.0
READ_CHUNK_SIZE = 64 * 1024

_WXGF_MAGIC = b"wxgf"
_VPS_START = b"\x00\x00\x00\x01\x40\x01"
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class WxgfError(Exception):
    """An error whose public message is only a stable WXGF_* code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def decode_wxgf(data: bytes, ffmpeg: str, ffprobe: str) -> bytes:
    """Decode one bounded WXGF image into PNG bytes.

    ``ffmpeg`` and ``ffprobe`` must be absolute paths to existing executable
    files.  No shell is used and no media, credential, or WeChat location is
    read by this function.
    """
    _validate_executable(ffmpeg, "WXGF_EXECUTABLE")
    _validate_executable(ffprobe, "WXGF_EXECUTABLE")

    if not isinstance(data, bytes):
        raise WxgfError("WXGF_INPUT_INVALID")
    if len(data) > MAX_INPUT_SIZE:
        raise WxgfError("WXGF_INPUT_TOO_LARGE")
    if not data.startswith(_WXGF_MAGIC):
        raise WxgfError("WXGF_HEADER_INVALID")

    hevc = _extract_hevc_partition(data)
    if _count_annexb_nals(hevc) > MAX_NALS:
        raise WxgfError("WXGF_TOO_MANY_NALS")

    width, height = _probe_hevc_stream(hevc, ffprobe)
    png = _encode_png(hevc, ffmpeg)
    _validate_png(png, width, height)
    return png


def _validate_executable(path: str, code: str) -> None:
    if (
        not isinstance(path, str)
        or not path
        or not os.path.isabs(path)
        or not os.path.isfile(path)
        or not os.access(path, os.X_OK)
    ):
        raise WxgfError(code)


def _extract_hevc_partition(data: bytes) -> bytes:
    occurrences: list[int] = []
    search_start = len(_WXGF_MAGIC)
    while True:
        index = data.find(_VPS_START, search_start)
        if index < 0:
            break
        occurrences.append(index)
        search_start = index + 1

    if not occurrences:
        raise WxgfError("WXGF_VPS_NOT_FOUND")
    if len(occurrences) > 1:
        raise WxgfError("WXGF_MULTIPLE_PARTITIONS")

    vps_index = occurrences[0]
    if vps_index < len(_WXGF_MAGIC) + 4:
        raise WxgfError("WXGF_PARTITION_INVALID")

    length_offset = vps_index - 4
    partition_length = int.from_bytes(data[length_offset:vps_index], "big")
    partition_end = vps_index + partition_length
    if partition_length <= 0 or partition_end > len(data):
        raise WxgfError("WXGF_PARTITION_INVALID")

    return data[vps_index:partition_end]


def _count_annexb_nals(data: bytes) -> int:
    count = 0
    index = 0
    while index + 3 <= len(data):
        if data[index : index + 3] == b"\x00\x00\x01":
            count += 1
            index += 3
        else:
            index += 1
    return count


def _probe_hevc_stream(data: bytes, ffprobe: str) -> tuple[int, int]:
    command = [
        ffprobe,
        "-max_pixels",
        "16000000",
        "-f",
        "hevc",
        "-count_frames",
        "-show_entries",
        "stream=codec_type,codec_name,width,height,nb_read_frames",
        "-of",
        "json",
        "-i",
        "pipe:0",
    ]
    try:
        result = subprocess.run(
            command,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=PROCESS_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise WxgfError("WXGF_FFPROBE_TIMEOUT") from None
    except OSError:
        raise WxgfError("WXGF_FFPROBE_FAILED") from None

    if result.returncode != 0:
        raise WxgfError("WXGF_FFPROBE_FAILED")

    try:
        document = json.loads(result.stdout.decode("utf-8"))
        streams = document["streams"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError):
        raise WxgfError("WXGF_STREAM_INVALID") from None

    if not isinstance(streams, list) or len(streams) != 1:
        raise WxgfError("WXGF_STREAM_INVALID")
    stream = streams[0]
    if not isinstance(stream, dict):
        raise WxgfError("WXGF_STREAM_INVALID")
    if stream.get("codec_type") != "video" or stream.get("codec_name") != "hevc":
        raise WxgfError("WXGF_STREAM_INVALID")

    frame_count = _parse_nonnegative_integer(stream.get("nb_read_frames"))
    width = _parse_nonnegative_integer(stream.get("width"))
    height = _parse_nonnegative_integer(stream.get("height"))
    if frame_count != 1:
        raise WxgfError("WXGF_STREAM_INVALID")
    if not 0 < width <= MAX_DIMENSION or not 0 < height <= MAX_DIMENSION:
        raise WxgfError("WXGF_STREAM_INVALID")
    if width * height > MAX_PIXELS:
        raise WxgfError("WXGF_STREAM_INVALID")
    return width, height


def _parse_nonnegative_integer(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _encode_png(data: bytes, ffmpeg: str) -> bytes:
    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-max_pixels",
        "16000000",
        "-xerror",
        "-err_detect",
        "explode",
        "-f",
        "hevc",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
    ]

    try:
        with tempfile.TemporaryFile() as input_file:
            input_file.write(data)
            input_file.flush()
            input_file.seek(0)
            try:
                process = subprocess.Popen(
                    command,
                    stdin=input_file,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
            except OSError:
                raise WxgfError("WXGF_FFMPEG_FAILED") from None

            chunks: list[bytes] = []
            total_size = 0
            oversized = False
            reader_error = False

            def read_output() -> None:
                nonlocal total_size, oversized, reader_error
                assert process.stdout is not None
                try:
                    while True:
                        chunk = process.stdout.read(READ_CHUNK_SIZE)
                        if not chunk:
                            break
                        total_size += len(chunk)
                        if total_size > MAX_OUTPUT_SIZE:
                            oversized = True
                            process.kill()
                            break
                        chunks.append(chunk)
                except (OSError, ValueError):
                    reader_error = True

            reader = threading.Thread(target=read_output, daemon=True)
            reader.start()
            timed_out = False
            try:
                returncode = process.wait(timeout=PROCESS_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                timed_out = True
                process.kill()
                returncode = process.wait()

            reader.join()
            if process.stdout is not None:
                process.stdout.close()
    finally:
        pass

    if timed_out:
        raise WxgfError("WXGF_FFMPEG_TIMEOUT")
    if oversized:
        raise WxgfError("WXGF_OUTPUT_TOO_LARGE")
    if reader_error:
        raise WxgfError("WXGF_FFMPEG_FAILED")
    if returncode != 0:
        raise WxgfError("WXGF_FFMPEG_FAILED")
    return b"".join(chunks)


def _validate_png(png: bytes, expected_width: int, expected_height: int) -> None:
    if len(png) < len(_PNG_SIGNATURE) or not png.startswith(_PNG_SIGNATURE):
        raise WxgfError("WXGF_PNG_INVALID")

    offset = len(_PNG_SIGNATURE)
    saw_ihdr = False
    saw_idat = False
    saw_iend = False
    while offset < len(png):
        if offset + 12 > len(png):
            raise WxgfError("WXGF_PNG_INVALID")
        chunk_length = int.from_bytes(png[offset : offset + 4], "big")
        chunk_type_offset = offset + 4
        chunk_data_offset = chunk_type_offset + 4
        chunk_crc_offset = chunk_data_offset + chunk_length
        chunk_end = chunk_crc_offset + 4
        if chunk_end > len(png):
            raise WxgfError("WXGF_PNG_INVALID")

        chunk_type = png[chunk_type_offset:chunk_data_offset]
        chunk_data = png[chunk_data_offset:chunk_crc_offset]
        expected_crc = int.from_bytes(png[chunk_crc_offset:chunk_end], "big")
        actual_crc = zlib.crc32(chunk_type)
        actual_crc = zlib.crc32(chunk_data, actual_crc) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise WxgfError("WXGF_PNG_INVALID")

        if not saw_ihdr:
            if chunk_type != b"IHDR" or chunk_length != 13:
                raise WxgfError("WXGF_PNG_INVALID")
            width = int.from_bytes(chunk_data[0:4], "big")
            height = int.from_bytes(chunk_data[4:8], "big")
            bit_depth = chunk_data[8]
            color_type = chunk_data[9]
            compression_method = chunk_data[10]
            filter_method = chunk_data[11]
            interlace_method = chunk_data[12]
            if (width, height) != (expected_width, expected_height):
                raise WxgfError("WXGF_PNG_INVALID")
            if bit_depth not in {1, 2, 4, 8, 16}:
                raise WxgfError("WXGF_PNG_INVALID")
            if color_type not in {0, 2, 3, 4, 6}:
                raise WxgfError("WXGF_PNG_INVALID")
            if compression_method != 0 or filter_method != 0:
                raise WxgfError("WXGF_PNG_INVALID")
            if interlace_method not in {0, 1}:
                raise WxgfError("WXGF_PNG_INVALID")
            saw_ihdr = True
        elif chunk_type == b"IHDR":
            raise WxgfError("WXGF_PNG_INVALID")

        if chunk_type == b"IDAT":
            if chunk_length == 0 or saw_iend:
                raise WxgfError("WXGF_PNG_INVALID")
            saw_idat = True
        elif chunk_type == b"IEND":
            if chunk_length != 0 or saw_iend:
                raise WxgfError("WXGF_PNG_INVALID")
            saw_iend = True

        offset = chunk_end

    if not saw_ihdr or not saw_idat or not saw_iend or offset != len(png):
        raise WxgfError("WXGF_PNG_INVALID")


__all__ = ["WxgfError", "decode_wxgf"]
