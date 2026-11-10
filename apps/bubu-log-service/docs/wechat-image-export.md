# 精确导出微信本地图片

`scripts/collector-wechat-images.py` 是显式调用的本地导出步骤，不启动采集作业或定时任务。输出的 `roots` 和 `mappings` 可作为 [采集器](./collector.md) 的 `media` 配置；`results` 是逐张导出回执，不应放入该配置。

需要已授权的微信本地读取环境、可导入 `wechat_cli` 和 `Crypto.Cipher.AES` 的 Python。导出器复用现有配置和解密缓存，不初始化微信配置。调用者必须提供同一账号、同一群的 1–20 条 `kind: "image"` 来源消息，消息结构来自 `collector-wechat-source.py`。

stdin 请求示意（`messages` 替换为实际来源消息数组）：

```json
{
  "accountId": "wxid_example_suffix",
  "chatId": "example@chatroom",
  "allowLive": true,
  "configPath": "/secure/wechat-cli/config.json",
  "outputDirectory": "/secure/decoded-images",
  "kvcommDirectory": "/absolute/path/to/WeChat/app_data/net/kvcomm",
  "ffmpeg": "/absolute/path/to/native/ffmpeg",
  "ffprobe": "/absolute/path/to/native/ffprobe",
  "messages": []
}
```

```sh
/absolute/path/to/wechat-cli/python scripts/collector-wechat-images.py \
  < /secure/image-request.json > /secure/image-result.json
```

请求、回执和解码文件应仅当前用户可读；导出目录为 `0700`，输出文件为 `0600`。不要提交真实来源消息、账号密钥或导出图片。

导出先核对来源 ID、原消息类型/时间/XML MD5、资源索引和该群该月份的唯一 hardlink，再解密 V2 文件并校验原始字节长度与 MD5。找不到文件或图片不匹配会返回 unavailable，不使用相邻文件代替。单张缺失或解码失败不阻断其他有效图片。

静态 PNG/JPEG/WebP 保留原始字节。WXGF 只接受受限的单帧 HEVC 分区，使用调用者显式提供、与本机架构匹配的 FFmpeg/FFprobe 转为 PNG；拒绝多分区和多帧输入。原始 WXGF 另存用于校验，转换后 PNG 使用独立 SHA-256，所以应使用 `mappings` 路径，而不是把转换后的 PNG 当作原 XML MD5 的字节匹配。上传阶段仍由附件服务完整验证图片。

此工具不解析视频、语音或文件附件，也不自动识别图片中的照护事实。导出成功、附件上传、关联原事件和手机端显示是不同验证阶段。

隔离测试：

```sh
/absolute/path/to/wechat-cli/python tests/collector-source.py
/absolute/path/to/wechat-cli/python tests/collector-images.py
FFMPEG_BIN=/absolute/path/to/native/ffmpeg \
FFPROBE_BIN=/absolute/path/to/native/ffprobe \
  /absolute/path/to/wechat-cli/python tests/collector-wxgf.py
```

测试使用合成 SQLite、加密图片及 HEVC 帧；不读取真实微信配置或启动采集。
