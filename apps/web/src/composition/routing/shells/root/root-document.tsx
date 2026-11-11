import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@tokenshame/ui/components/sonner";

export const RootDocument = () => (
  <html lang="en" className="dark">
    <head>
      <HeadContent />
    </head>
    <body>
      <div className="grid h-svh grid-rows-[auto_1fr]">
        <Outlet />
      </div>
      <Toaster richColors />
      <TanStackRouterDevtools position="bottom-left" />
      <Scripts />
    </body>
  </html>
);
