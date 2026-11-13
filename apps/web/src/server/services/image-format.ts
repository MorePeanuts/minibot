import type { ImageMediaType } from "@/lib/chat/attachments";

export function imageMediaType(bytes: Buffer): ImageMediaType | null {
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("latin1", 12, 16) === "IHDR"
  )
    return "image/png";

  if (
    bytes.length >= 14 &&
    ["GIF87a", "GIF89a"].includes(bytes.toString("latin1", 0, 6)) &&
    bytes.at(-1) === 0x3b
  )
    return "image/gif";

  if (
    bytes.length >= 20 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.readUInt32LE(4) === bytes.length - 8 &&
    bytes.toString("latin1", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("latin1", 12, 16))
  )
    return "image/webp";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  )
    return "image/jpeg";

  return null;
}
