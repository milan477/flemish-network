# Microsoft Dynamics Integration Options

## What Dynamics Means Here

Microsoft Dynamics usually refers to the Dynamics 365 business-app suite. For this project, the relevant part is the CRM side: Dynamics 365 Sales, Customer Service, Customer Insights, and the Dataverse/Power Platform layer behind them.

This webapp is a specialized Flemish network intelligence platform. It manages people, organizations, locations, sectors, Flemish ties, discovery evidence, verification suggestions, collections, exports, maps, and AI search. Dynamics would normally be the broader institutional CRM for official relationship management: contacts, accounts, leads, activities, events, email history, ownership, segmentation, and reporting.

The cleanest positioning is:

| System | Best Role |
|---|---|
| Flemish Network app | Discovery, enrichment, Flemish-specific metadata, AI search, map exploration, evidence, verification, mission/event collections |
| Dynamics 365 / Dataverse | Official CRM record, activity tracking, staff ownership, campaigns/events, email/task workflows, institutional reporting |

## Integration Possibilities

### 1. Manual Export / Import

The app already supports structured contact exports through CSV and Excel. Staff can export selected search results or collection members and import them into Dynamics.

Good for:
- Pilot usage.
- One-off delegations, trade missions, and event lists.
- Validating field mappings before deeper integration.

Limitations:
- No ongoing sync.
- Manual deduplication.
- No reliable feedback loop from Dynamics back into this app.

### 2. Push Approved Contacts to Dynamics

When a person is approved, curated, or added to a collection, an Edge Function could create or update a Dynamics/Dataverse row.

Likely mappings:

| Local App | Dynamics / Dataverse |
|---|---|
| `people` | Contact, Lead, or custom table |
| `organizations` | Account or custom table |
| `locations` | Address fields or related location table |
| `sectors` | Choices, tags, or related rows |
| `flemish_connections` | Custom table, tags, or many-to-many relationship |
| `collections` | Marketing list, campaign/event list, or custom table |

Good for:
- Using this app as the discovery and enrichment layer.
- Keeping Dynamics as the official relationship-management system.
- Sending high-confidence contacts downstream after staff review.

Implementation notes:
- Add local external IDs such as `dynamics_contact_id` and `dynamics_account_id`.
- Store sync status, last sync timestamp, and last sync error.
- Make the sync idempotent by matching on external ID first, then email, LinkedIn URL, or normalized name.

### 3. Pull Dynamics Contacts Into This App

If Dynamics is the source of truth, this app can periodically read Dynamics contacts/accounts from Dataverse and enrich them locally.

Good for:
- Avoiding duplicate official contact records.
- Adding map/search/discovery/verification features around existing CRM data.
- Letting Dynamics users keep their current workflows.

Implementation notes:
- Treat Dynamics-owned fields as read-only or carefully governed locally.
- Store local-only metadata in this app: Flemish ties, discovery evidence, derived labels, embeddings, verification suggestions, and collection intelligence.
- Rebuild embeddings after imported records change.

### 4. Two-Way Sync

Two-way sync is possible but should be treated as a later phase. It needs explicit field ownership and conflict rules.

Example ownership model:

| Field / Concept | System of Record |
|---|---|
| Official contact name, email, phone | Dynamics |
| Account/contact ownership and activity history | Dynamics |
| Flemish connections | Flemish Network app |
| Discovery evidence and source URLs | Flemish Network app |
| AI verification suggestions | Flemish Network app |
| Event/mission list membership | Depends on delegation workflow |

Risks:
- Duplicate contacts.
- Conflicting edits.
- Partial failures.
- Staff uncertainty about which system to trust.

Required before implementation:
- Dedupe policy.
- Field ownership matrix.
- Conflict review queue.
- Audit log.
- Retry/backoff behavior.
- Operator-visible sync health.

### 5. Power Automate Bridge

Power Automate can connect Dataverse/Dynamics to HTTP endpoints and many Microsoft services. This is often attractive for non-engineering teams because flows are visible and editable inside the Microsoft environment.

Possible flows:
- When a Dataverse contact changes, call a Supabase Edge Function to refresh the local person.
- When this app approves a contact, call a Power Automate HTTP-triggered flow that creates or updates a Dynamics contact.
- When a collection is finalized, create a Dynamics campaign/event list.

Good for:
- Early integration without building a full custom connector.
- Delegation-owned automation.
- Microsoft-first governance.

Limitations:
- Licensing and connector restrictions may apply.
- Error handling can become fragmented if flows grow too complex.
- High-volume sync is better handled with direct API integration.

### 6. Direct Dataverse Web API Integration

For a robust integration, build Supabase Edge Functions that call the Dataverse Web API. Dataverse exposes a REST/OData API for Dynamics data.

Likely app changes:
- New Edge Function, for example `sync-dynamics`.
- Microsoft Entra app registration for service authentication.
- New secrets for tenant/client credentials and Dataverse environment URL.
- New local sync columns/tables.
- Admin UI for sync status and retry.

Good for:
- Production-grade sync.
- Clear error handling.
- Testable backend-owned integration.
- Keeping credentials out of the browser.

### 7. Microsoft Entra ID Staff Login

Authentication integration is separate from contact-data integration. The app currently uses Supabase Auth and staff allowlisting. A future phase could let delegation staff sign in with Microsoft Entra ID.

Good for:
- Microsoft account SSO.
- Easier staff onboarding/offboarding.
- Alignment with delegation IT policy.

This does not automatically integrate contact records with Dynamics; it only changes how staff authenticate.

## Recommended Phasing

1. Keep CSV/XLSX export as the immediate low-risk bridge.
2. Define field mapping with the delegation: Contact vs Lead, Account vs Organization, tags vs custom tables.
3. Add local external ID and sync-status fields.
4. Build one-way push from reviewed/approved contacts or collections to Dynamics.
5. Add pull or two-way sync only after the source-of-truth rules are agreed.

## Open Questions for the Delegation

- Which Dynamics app are they using: Sales, Customer Service, Customer Insights, Business Central, or another module?
- Is Dataverse available in their tenant?
- Are contacts represented as Contacts, Leads, Accounts, Marketing Lists, Campaigns, Events, or custom tables?
- Should this app create official CRM records, or only propose records for review?
- Which system owns contact details after the first sync?
- Do they need activity/email/task history in this app, or only a link back to Dynamics?
- Who owns Microsoft tenant administration and app registration approval?

## References

- Microsoft integration platform guidance: https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/integrate-other-solutions-choose-platform
- Dataverse Web API overview: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview
- Power Automate with Dataverse: https://learn.microsoft.com/en-us/power-automate/dataverse/overview
