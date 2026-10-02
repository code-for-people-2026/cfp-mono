// 图片转为 base64 后会变长，CMS 字段容量必须与处理后的字节上限一致。
export const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_STORED_IMAGE_BASE64_LENGTH =
  4 * Math.ceil(MAX_STORED_IMAGE_BYTES / 3);
