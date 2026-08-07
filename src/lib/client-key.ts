/**
 * UUIDv7 generation.
 *
 * Every entry the client creates carries one, minted BEFORE the mutation is
 * sent. The mutation looks it up and returns the existing row instead of
 * inserting, so a retry after a lost response cannot duplicate an entry — which
 * is exactly the situation on a phone with bad signal, when nobody is watching.
 *
 * v7 rather than v4 because the first 48 bits are the timestamp, so keys sort
 * chronologically. That costs nothing here and makes any future debugging or
 * import ordering free.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"))

export function newClientKey(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // 48-bit big-endian timestamp in bytes 0-5.
  const ms = Math.max(0, Math.floor(now))
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff
  bytes[5] = ms & 0xff

  // Version 7 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const h = (i: number) => HEX[bytes[i]]
  return (
    `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-` +
    `${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
  )
}
