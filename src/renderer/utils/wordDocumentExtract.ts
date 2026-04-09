/**
 * Extract text and embedded images from a .docx (Word) file using mammoth.
 * Images appear in the text stream as placeholders [DOCIMG:1], [DOCIMG:2], … in document order.
 * Legacy .doc is not supported.
 */

import mammoth from 'mammoth'

/** Internal marker — unlikely to appear in normal Word text; replaced in UI after import. */
export const DOC_IMG_PLACEHOLDER_PREFIX = '[DOCIMG:'
export const DOC_IMG_PLACEHOLDER = (index: number) => `${DOC_IMG_PLACEHOLDER_PREFIX}${index}]`

export interface WordDocumentExtractOptions {
  /** Shown in text where an embedded image cannot be imported (e.g. unsupported MIME). */
  unsupportedImageLabel?: string
}

export interface WordDocumentExtractResult {
  /**
   * Plain text with newlines; inline images become \\n[DOCIMG:n]\\n in reading order
   * (n matches 1-based index into imageDataUrls).
   */
  textWithPlaceholders: string
  /** data: URLs in the same order as [DOCIMG:n] markers (supported formats only). */
  imageDataUrls: string[]
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl.trim())
  if (!m) return null
  return { mime: m[1].trim(), base64: m[2].replace(/\s/g, '') }
}

const VISION_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function isSupportedVisionDataUrl(src: string): boolean {
  const p = parseDataUrl(src)
  return !!p && VISION_MIMES.includes(p.mime)
}

/** Build a File from a data URL (for image pipeline). */
export function dataUrlToImageFile(dataUrl: string, filename: string): File | null {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null
  if (!VISION_MIMES.includes(parsed.mime)) return null
  try {
    const bin = atob(parsed.base64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const ext =
      parsed.mime === 'image/jpeg'
        ? 'jpg'
        : parsed.mime === 'image/png'
          ? 'png'
          : parsed.mime === 'image/gif'
            ? 'gif'
            : 'webp'
    const base = filename.replace(/\.[^/.]+$/, '')
    return new File([arr], `${base}.${ext}`, { type: parsed.mime })
  } catch {
    return null
  }
}

/**
 * Convert .docx to HTML with inlined images, then replace each img in document order
 * with a placeholder span (supported → [DOCIMG:n], unsupported → label text).
 */
export async function extractWordDocument(
  arrayBuffer: ArrayBuffer,
  options?: WordDocumentExtractOptions
): Promise<WordDocumentExtractResult> {
  const unsupportedLabel =
    options?.unsupportedImageLabel ?? '[Embedded image omitted — unsupported format]'

  const mammothOpts = {
    convertImage: mammoth.images.imgElement((image) => {
      return image.read('base64').then((imageBuffer) => {
        const contentType = image.contentType || 'image/png'
        return {
          src: `data:${contentType};base64,${imageBuffer}`,
        }
      })
    }),
  }

  const result = await mammoth.convertToHtml({ arrayBuffer }, mammothOpts)
  if (result.messages?.length) {
    for (const msg of result.messages) {
      if (msg.type === 'error') {
        console.warn('[wordDocumentExtract]', msg.message)
      }
    }
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(result.value || '', 'text/html')
  const body = doc.body
  if (!body) {
    return { textWithPlaceholders: '', imageDataUrls: [] }
  }

  const imgs = Array.from(body.querySelectorAll('img[src^="data:"]'))
  const imageDataUrls: string[] = []

  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (!src) {
      img.remove()
      continue
    }
    const marker = doc.createElement('span')
    if (isSupportedVisionDataUrl(src)) {
      imageDataUrls.push(src)
      marker.textContent = `\n${DOC_IMG_PLACEHOLDER(imageDataUrls.length)}\n`
    } else {
      marker.textContent = `\n${unsupportedLabel}\n`
    }
    img.replaceWith(marker)
  }

  const textWithPlaceholders = (body.innerText || body.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { textWithPlaceholders, imageDataUrls }
}
