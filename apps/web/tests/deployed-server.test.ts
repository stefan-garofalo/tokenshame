import fixture from "@tokenshame/share-link/fixtures/v1.json";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startServer } from "./http-harness";
import type { WebServer } from "./http-harness";

const buildTimeoutMs = 300_000;
const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

// The harness starts the server with only the node binary on PATH, as on Vercel.
describe("built server without varlock on PATH", () => {
  let server: WebServer;

  beforeAll(async () => {
    server = await startServer();
  }, buildTimeoutMs);

  afterAll(() => server.stop());

  it("redirects / with 308", async () => {
    const response = await fetch(`${server.url}/`, { redirect: "manual" });

    expect(response.status).toBe(308);
  });

  it("serves the Share Page as HTML", async () => {
    const response = await fetch(`${server.url}/r/${fixture.link}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("serves the Share Card as PNG", async () => {
    const response = await fetch(`${server.url}/r/${fixture.link}/og.png`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(bytes.slice(0, 4)).toStrictEqual(pngSignature);
  });
});
