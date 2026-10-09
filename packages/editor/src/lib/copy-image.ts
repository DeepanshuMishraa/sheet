/**
 * Puts a PNG on the clipboard. The blob is handed over as a promise, so the
 * browser counts the click that started it as the permission to write even
 * though rendering the picture takes a moment; Safari-based webviews refuse the
 * write otherwise.
 */
export async function copyImage(png: Promise<Blob>) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('This window cannot copy images to the clipboard')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
