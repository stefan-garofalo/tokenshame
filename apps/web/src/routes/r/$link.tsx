import { createFileRoute } from "@tanstack/react-router";

import { shareRoute } from "../../composition/routing/pages/share";

export const Route = createFileRoute("/r/$link")(shareRoute);
