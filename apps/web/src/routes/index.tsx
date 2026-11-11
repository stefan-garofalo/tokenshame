import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "../composition/routing";

export const Route = createFileRoute("/")({
  component: HomePage,
});
