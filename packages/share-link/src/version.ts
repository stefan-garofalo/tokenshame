import * as Schema from "effect/Schema";

/**
 * Every Share Link version ever shipped. Old links decode forever, so a release
 * adds a literal here and never removes one.
 */
export const Version = Schema.Literal(1);
export type Version = typeof Version.Type;

/** The version `encode` writes. */
export const currentVersion: Version = 1;
