import { createHash } from "crypto"

export namespace Hash {
  export function fast(input: string | Buffer): string {
    if (typeof input === "string") return createHash("sha1").update(input).digest("hex")
    return createHash("sha1").update(new Uint8Array(input)).digest("hex")
  }
}
