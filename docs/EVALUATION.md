# AI Evaluation

This project should judge AI quality by evidence and reviewer value, not by how many model calls run or how many candidates are generated.

## Default Discovery Standards

### Valid Flemish / Belgian Tie

Strong evidence:

- Flemish universities: KU Leuven, UGent, VUB, UAntwerp, UHasselt, Vlerick, or other Belgian university.
- Flemish/Belgian research and innovation institutions: imec, VITO, Flanders Make, VIB
- Fellowships and programs: BAEF, Fayat, Belgian American Educational Foundation, Fulbright Belgium
- Flemish government, Flanders Investment & Trade, diplomatic/public-sector roles tied to Flanders or Belgium
- Person-level evidence that someone was born, educated, employed, funded, or institutionally affiliated in Flanders

Weak evidence:

- Vague use of "Belgian" or "Flemish" without tying it to the person
- A page that mentions Belgium/Flanders elsewhere but not as evidence for the candidate
- Event attendance or a one-off mention with no durable network relevance

### Valid US Relevance

Strong evidence:

- Current US job, board role, advisory role, lab, university, company, or organization
- Current US city/state, office, or address
- US-based founder/executive/researcher/faculty/student profile
- Recent or repeated US collaboration
- Past US role that is still useful for network context
- US event/speaker role with substantive professional relevance

Weak evidence:

- One old US event with no current tie
- US mention only in a generic page template or search snippet
- US connection cannot be traced to the person

### Valid Organization Discovery

Include organizations with direct evidence for at least one of these patterns:

- Belgian or Flemish companies with US offices, factories, labs, accelerators, partner sites, event sites, or active US expansion targets.
- US organizations connected to Flanders through partnerships, investment, research collaboration, trade access, or institutional programs.
- Chambers of commerce, trade offices, consulates, economic development agencies, accelerators, universities, labs, funds, and institutional connectors that help the Flanders-US network.
- US-based organizations whose description, programs, portfolio, or leadership show concrete Flemish or Belgian relevance.

Reject organizations when the only evidence is ordinary employment of one Flemish-connected person, generic directory text, a one-off mention, weak search-result snippets, or unverifiable strategic relevance.

## Discovery Evaluation

Question: does discovery find real, relevant people with reviewable evidence?

Human scoring rubric:

- **Accept:** named person, plausible US relevance, explicit Flemish/Belgian evidence, useful source URL.
- **Merge:** real relevant person already in `people`, new evidence improves the record.
- **Reject:** no Flemish/Belgian tie, no US relevance, stale/unsupported evidence, organization-only result, or obvious duplicate.
- **Needs tuning:** repeated low-value domains, generic queries, missing evidence excerpts, many candidates with only weak snippets.

Quality gates before autonomy:

- Most approved candidates have evidence that explains both the Flemish/Belgian tie and US relevance.
- Duplicate rate is low enough that reviewers are not spending most time merging.
- Frontier/planning actions produce new useful pages, not repeated versions of the same query.
- Discovery never auto-promotes to `people` or `organizations`; it creates pending review work.
- Manual intake and imports never auto-promote to `people` or `organizations`; row-level validation blocks malformed contact fields, malformed URLs, organization rows without evidence, and partial US location evidence before pending candidates are created.
- Import preview shows the mapped row columns in a horizontally scrollable table, truncating long bios, and successful imports refresh the pending review queues immediately.
- Organization candidates are promoted only through explicit reviewer approval or merge, with source URLs and evidence excerpts visible in review.
- Active UI source must not call retired Discovery endpoints or retired `ai-agent` Discovery tasks; prompted Discovery runs only through `agent-scheduler`.

## Verification Evaluation

Question: are suggestions correct, evidence-backed, and conservative?

Human scoring rubric:

- **Correct:** suggested value is true and supported by the displayed evidence.
- **Wrong:** suggested value is false or belongs to another person.
- **Unsupported:** suggestion might be true, but evidence does not prove it.
- **Too risky:** suggestion should stay in review even if likely true.
- **Missed:** source clearly shows an update, but no suggestion was produced.


Severe mistakes:

- Suggestion belongs to a different person.
- Suggestion says someone left the US or is no longer relevant without strong evidence.
- Suggestion overwrites a good current role with stale data.
- Suggestion invents or overstates a Flemish/Belgian tie.
- Durable suggestion has no source URL, evidence, method, or clear provenance.

Flemish/Belgian fact quality gate: accepted Discovery or verification facts must resolve to a canonical entity or reviewed alias. Uncertain raw phrases should stay as evidence or pending aliases instead of becoming default filter chips.

## Collection Suggestion Evaluation

Question: does Build A Collection produce useful draft candidates from existing approved records without changing the database until staff approve them?

Human scoring rubric:

- **Accept:** existing person or organization clearly fits the collection goal, with a useful reason and enough snippet/source context for staff review.
- **Reject:** candidate is off-topic, weakly related, duplicate, already in the collection, or based on a missing-database assumption rather than an approved record.
- **Needs Discovery:** the prompt points to a plausible coverage gap that should be expanded through Discovery, not hidden collection generation.
- **Needs tuning:** parser searches are too broad, reranking favors generic matches, rejected candidates reappear before reset, or organization candidates crowd out stronger people matches without rationale.

Quality gates:

- Suggestions are draft-only until staff approve them.
- Mixed people and organization suggestions use `entity_type` and save through exactly one `person_id` or `organization_id`.
- Rejected candidates stay suppressed in the current draft until reset or undo.
- Collection detail drafts survive route revisits in browser storage and can be refreshed or reset explicitly.
- Suggestion clicks on collection detail open an in-place profile preview before any full-profile navigation.
- Existing collection members and draft exclusions are not re-suggested.
- Reranking never introduces IDs outside the retrieved candidate set.
- Discovery handoff only pre-fills `/admin/discovery?prompt=...`; it does not start `agent-scheduler`.

Phase 4 acceptance criteria:

- `suggest-people` is described to users and docs as collection suggestions, while the deployed function name remains unchanged.
- Organization candidates come from approved organization lexical, vector, and text-chunk retrieval when embeddings are available.
- Collection prompts may produce a Discovery handoff, but Phase 4 does not add autonomous Discovery, persistent gap analytics, or persistent draft tables.
- Collection organization retrieval uses canonical organization Flemish/Belgian facts when available; durable organization verification remains a later record-level verification phase.

## Planning / Next Searches Evaluation

Question: are recommended next searches specific, evidence-based, and likely to improve coverage?

Score each recommended action:

- **Specificity:** points at a metro, domain, source family, sector, or entity pivot.
- **Novelty:** avoids domains and queries already exhausted.
- **Evidence basis:** comes from a coverage gap, proven domain, or evidence-backed entity pivot.
- **Actionability:** an operator understands why it is being recommended.
- **Yield:** after running, it creates useful frontier pages or candidates.
- **Diversity:** not all recommendations repeat one source family or city.

Good recommendation examples:

- Expand Boston biotech domains from approved KU Leuven profiles.
- Refresh BAEF/Fayat source pack for New York.
- Follow an imec-linked startup entity pivot into California team and advisory-board pages.
- Revisit a proven university/lab domain with remaining weekly budget and recent yield.

Bad recommendation examples:

- "Belgian people in Boston"
- "Flemish professionals USA"
- Repeated searches for an already exhausted domain
- Broad open-web searches that do not name a source family, geography, sector, domain, or entity pivot
