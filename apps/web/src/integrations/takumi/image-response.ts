import type { ReactNode } from "react";
import { ImageResponse } from "takumi-js/response";

/** A font for a render. `data` is the font file's bytes. */
export interface ImageFont {
  readonly name: string;
  readonly weight: number;
  readonly data: Uint8Array;
}

/**
 * Decodes a font that Vite inlined as a `data:` URL, with an `?inline` import. Call it once, at module
 * load: the bytes then live in the bundle and nothing reads the disk when a request comes in.
 */
export const fontFromDataUrl = (name: string, weight: number, dataUrl: string): ImageFont => ({
  data: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
  name,
  weight,
});

/**
 * A PNG response drawn from `element`. Takumi resolves its backend from the import conditions of the
 * build: Nitro picks WebAssembly, so the function carries no native addon. The response is ready only
 * after the picture is drawn, so a failed render throws here and is never sent as a cut-off image.
 */
export const pngResponse = async (
  element: ReactNode,
  width: number,
  height: number,
  fonts: ImageFont[],
  headers: HeadersInit,
): Promise<Response> => {
  const response = new ImageResponse(element, { fonts, format: "png", headers, height, width });
  await response.ready;
  return response;
};
