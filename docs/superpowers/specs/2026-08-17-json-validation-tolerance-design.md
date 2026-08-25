# JSON Validation Tolerance Design

## Goal

Reduce unnecessary local-CLI fallback caused by harmless prose around one valid analysis JSON object, while preserving deterministic rejection of ambiguous or structurally unusable responses.

## Behavior

- Accept a bare JSON object, one `json`/unlabelled fenced JSON object, or one uniquely decodable JSON object surrounded by non-JSON prose.
- Reject multiple JSON objects, multiple fences, non-JSON fences, non-object roots, and malformed or parser-incompatible core fields.
- Keep schema validation advisory and the existing minimal parser contract authoritative.
- Strengthen the stock-analysis system prompt so the requested output is one JSON object without prose or Markdown fences.

## Diagnostics

When LiteLLM validates a fallback model response, log the actual attempted model and the structured validation reason. Do not expose the full model response. The structured exception may retain the generation backend identity; the per-attempt log is the authoritative model-attribution record.

## Verification

Regression tests cover prose-wrapped unique JSON acceptance, multiple-object rejection, prompt constraints, and accurate LiteLLM model/reason logging. Existing report-schema and local-CLI tests must remain green.
