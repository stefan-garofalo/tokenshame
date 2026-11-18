import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@tokenshame/ui/components/sonner";

export const RootDocument = () => (
  <html lang="en" className="dark">
    <head>
      <HeadContent />
      {/* One theme-color per scheme: Omarchy Matte Black, or Flexoki Light. They live here because
          the router's head keeps a single meta per name. */}
      <meta content="#090909" media="(prefers-color-scheme: dark)" name="theme-color" />
      <meta content="#fffcf0" media="(prefers-color-scheme: light)" name="theme-color" />
    </head>
    <body>
      <div className="grid min-h-svh grid-rows-[auto_1fr]">
        <Outlet />
      </div>
      <Toaster richColors />
      <TanStackRouterDevtools position="bottom-left" />
      <Scripts />
    </body>
  </html>
);
