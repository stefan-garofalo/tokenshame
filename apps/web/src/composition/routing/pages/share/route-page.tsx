import { getRouteApi } from "@tanstack/react-router";

import { BrokenLinkPage } from "./broken-link-page";
import { SharePage } from "./share-page";

const routeApi = getRouteApi("/r/$link");

export const RoutePage = () => {
  const data = routeApi.useLoaderData();
  return data._tag === "Shared" ? <SharePage roast={data} /> : <BrokenLinkPage />;
};
