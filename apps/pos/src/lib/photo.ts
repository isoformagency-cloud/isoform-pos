/** Phone photos are large, so they're shrunk here before upload. */
export async function shrink(file: File, longest = 1600) {
  const image = await createImageBitmap(file)
  const scale = Math.min(1, longest / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read that photo.'))), 'image/jpeg', 0.78))
}
