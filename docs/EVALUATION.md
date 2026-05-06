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
- Discovery never auto-promotes to `people`; it creates pending review work.

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
