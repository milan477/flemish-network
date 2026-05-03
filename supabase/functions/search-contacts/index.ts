import { handleDiscoverContactsRequest } from "../_shared/discoverContacts.ts";

// Compatibility endpoint for older scripts. New call sites must use
// discover-contacts; this wrapper keeps the old URL working while making the
// canonical replacement visible to clients.
Deno.serve(async (req: Request) => {
  const response = await handleDiscoverContactsRequest(req);
  const headers = new Headers(response.headers);
  headers.set("Deprecation", "true");
  headers.set("Link", '</functions/v1/discover-contacts>; rel="successor-version"');
  headers.set("X-Replaced-By", "discover-contacts");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
