/**
 * Extract text content from various document formats:
 * .docx, .xlsx, .csv, .txt, .md
 */

import * as XLSX from 'xlsx'
import { extractWordDocument } from './wordDocumentExtract'

export interface DocumentExtractResult {
  text: string
  /** data: URLs for embedded images (docx only). */
  imageDataUrls?: string[]
}

export async function extractDocument(
  file: File,
  options?: { unsupportedImageLabel?: string }
): Promise<DocumentExtractResult> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer()
    const result = await extractWordDocument(arrayBuffer, {
      unsupportedImageLabel: options?.unsupportedImageLabel ?? 'Word document image omitted',
    })
    return { text: result.textWithPlaceholders, imageDataUrls: result.imageDataUrls }
  }

  if (name.endsWith('.xlsx')) {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    const parts: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      if (csv.trim()) {
        // Indicate sheet boundaries so the content is meaningful in conversation
        parts.push(sheetName)
        parts.push(csv)
      }
    }
    return { text: parts.join('\n\n') }
  }

  if (name.endsWith('.csv')) {
    const text = await file.text()
    return { text: text.trim() }
  }

  // .txt, .md and any other plain-text format
  const text = await file.text()
  return { text: text.trim() }
}
