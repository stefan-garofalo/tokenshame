import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { maxModels, ModelUsage, Summary, Tokens } from "./summary";

/** A Share Link that cannot be decoded: malformed, truncated, or from an unknown version. */
export class BrokenLink extends Schema.TaggedError<BrokenLink>()("BrokenLink", {
  reason: Schema.String,
}) {}

// Short keys keep the worst-case link under 2,000 characters. Wire version 1 is frozen:
// a change here breaks every link already shared. Ship a new version instead.
const tokenKeys = { input: "i", output: "o", cacheRead: "r", cacheWrite: "w" } as const;

const WireTokens = Tokens.pipe(Schema.encodeKeys(tokenKeys));
const WireModel = ModelUsage.pipe(Schema.encodeKeys({ ...tokenKeys, model: "n" }));

const WireSummary = Summary.mapFields((fields) => ({
  ...fields,
  models: Schema.Array(WireModel).check(Schema.isMaxLength(maxModels)),
  other: WireTokens,
})).pipe(
  Schema.encodeKeys({
    version: "v",
    models: "m",
    other: "x",
    sessions: "s",
    busiestHour: "h",
    firstDay: "d",
  }),
);

const Link = Schema.StringFromBase64Url.pipe(Schema.decodeTo(Schema.fromJsonString(WireSummary)));

const decodeLink = Schema.decodeUnknownEffect(Link, { onExcessProperty: "error" });
const encodeLink = Schema.encodeSync(Link);

/** Encodes a Usage Summary as the Share Link payload: base64url, safe in a URL path. */
export const encode = (summary: Summary): string => encodeLink(summary);

/**
 * Decodes a Share Link payload from any version ever shipped. Anything else fails
 * with `BrokenLink`: garbage, truncation, an unknown version, or an out-of-range number.
 */
export const decode = (link: string): Effect.Effect<Summary, BrokenLink> =>
  decodeLink(link).pipe(Effect.mapError((error) => new BrokenLink({ reason: error.message })));

/** The public Share Page URL of a Share Link payload on the given site origin. */
export const shareUrl = (origin: string, link: string): string =>
  new URL(`/r/${link}`, origin).href;
