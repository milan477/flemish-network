import { handleDiscoverContactsRequest } from "../_shared/discoverContacts.ts";

// Legacy alias. Prefer the discover-contacts edge function for new call sites.
Deno.serve(handleDiscoverContactsRequest);
