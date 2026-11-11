import { createFileRoute } from "@tanstack/react-router";

import { shareCardResponse } from "../../../composition/routing/pages/share-card";

export const Route = createFileRoute("/r/$link/og.png")({
  server: {
    handlers: {
      GET: ({ params }) => shareCardResponse(params.link),
    },
  },
});
