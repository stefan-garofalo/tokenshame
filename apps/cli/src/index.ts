#!/usr/bin/env node
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command, Flag } from "effect/cli";
import { HttpRouter, HttpServer, HttpStaticServer } from "effect/http";

import { version } from "../package.json";

// The web SPA build is copied next to the bundle at build time (see tsdown.config.ts).
const webRoot = fileURLToPath(new URL("web", import.meta.url));

const reportServer = (port: number) =>
  HttpRouter.serve(HttpStaticServer.layer({ index: "_shell.html", root: webRoot, spa: true }), {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(
    // Bind loopback only: the report page must never be reachable from the network.
    Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port })),
  );

const tokenshame = Command.make(
  "tokenshame",
  {
    port: Flag.Int("port").pipe(
      Flag.withDescription("Local port for the report page (0 picks a free one)"),
      Flag.withDefault(0),
    ),
  },
  ({ port }) =>
    HttpServer.addressFormattedWith((address) =>
      Console.log(`tokenshame report → ${address}`),
    ).pipe(Effect.andThen(Effect.never), Effect.provide(reportServer(port))),
);

NodeRuntime.runMain(Command.run(tokenshame, { version }).pipe(Effect.provide(NodeServices.layer)));
