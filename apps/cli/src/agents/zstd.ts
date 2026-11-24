import * as zlib from "node:zlib";

/** Decompresses zstd data. */
export type Decompress = (data: Uint8Array) => Uint8Array;

/**
 * Node's zstd decoder, or none on a Node that has none: `zstdDecompressSync` exists only on
 * Node 22.15 and later, although the types always list it. A reader that meets compressed
 * data without it reports the source as `unreadable` with `zstdMissing`.
 */
export const zstdDecompress: Decompress | undefined =
  "zstdDecompressSync" in zlib ? (data) => zlib.zstdDecompressSync(data) : undefined;

/** The detail of a source that needs zstd on a Node without it. */
export const zstdMissing = "compressed logs need Node 22.15 or newer";
