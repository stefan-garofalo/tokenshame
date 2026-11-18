import { createFileRoute, redirect } from "@tanstack/react-router";

const repoUrl = "https://github.com/stefan-garofalo/tokenshame";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ href: repoUrl, statusCode: 308 });
  },
});
