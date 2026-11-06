/**
 * 图片文件头（magic bytes）识别
 *
 * 为什么需要：multer 的 `file.mimetype` 来自客户端提交的 Content-Type，可以随便伪造。
 * 只校验它等于「把文件改名成 .png 就通过」，因此落盘前必须用二进制头再验一次。
 *
 * 只覆盖白名单里的位图格式（SVG 是 XML 文本、可内嵌 <script>，不在上传白名单内）。
 */
export interface ImageSignature {
  /** 标准 MIME */
  mime: string
  /** 规范化扩展名（不含点，落盘统一用这个，避免「.html 里装着 png」） */
  ext: string
}

/** PNG 固定签名：89 50 4E 47 0D 0A 1A 0A */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 从文件头识别真实图片类型；无法识别返回 null */
export function detectImageSignature(buffer: Buffer | undefined): ImageSignature | null {
  if (!buffer || buffer.length < 12) {
    return null
  }

  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { mime: 'image/png', ext: 'png' }
  }

  // JPEG：FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }

  // GIF：GIF87a / GIF89a
  const head6 = buffer.subarray(0, 6).toString('ascii')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' }
  }

  // WEBP：RIFF....WEBP
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }

  // BMP：BM
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mime: 'image/bmp', ext: 'bmp' }
  }

  return null
}
