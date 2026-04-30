# Environment Variables

## Frontend (`.env`)
| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

## Edge Functions (Supabase dashboard secrets)

### Required
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API access |
| `SUPABASE_URL` | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for edge functions |

### Web Search
| Variable | Purpose |
|---|---|
| `TAVILY_API_KEY` | Primary web search (1000 calls/mo free) |
| `BRAVE_API_KEY` | Fallback web search |

### External Services
| Variable | Purpose |
|---|---|
| `APIFY_TOKEN` | LinkedIn scrape (discovery + verification agents) |

### Gemini Model Overrides (all optional)
| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_FLASH_MODEL` | `gemini-2.5-flash` | Flash model override |
| `GEMINI_FLASH_LITE_MODEL` | `gemini-2.5-flash-lite` | Flash Lite model override |
| `GEMINI_PRO_MODEL` | `gemini-2.5-pro` | Pro model override |
| `GEMINI_QUERY_MODEL` | — | Per-route override for query parsing |
| `GEMINI_CLASSIFICATION_MODEL` | — | Per-route override for classification |
| `GEMINI_EXTRACTION_MODEL` | — | Per-route override for extraction |
| `GEMINI_PROFILE_MODEL` | — | Per-route override for profile verification |
| `GEMINI_MERGE_MODEL` | — | Per-route override for text merge |
| `GEMINI_EVAL_MODEL` | — | Per-route override for evaluation |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Embedding model — changing requires full re-embed plan |

Each per-route override also has a `_FALLBACK_MODEL` variant (e.g. `GEMINI_QUERY_MODEL_FALLBACK_MODEL`).
