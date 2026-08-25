# Generation Backend Smoke Test Timeout Design

## Goal

Prevent the Web settings page from reporting a false timeout while a generation-backend smoke test is still running, and investigate the observed DeepSeek empty-stream fallback without changing unrelated providers.

## Scope

- Give the generation-backend smoke-test HTTP request a dedicated client timeout that matches the backend's 300-second default and maximum expected smoke-test duration.
- Keep the shared API client timeout unchanged for all other requests.
- Add a frontend regression test that verifies the dedicated timeout.
- Verify the existing empty-stream fallback behavior with focused tests and runtime evidence.
- Change DeepSeek streaming behavior only if the empty-stream condition is reproducible and provider-specific.
- Update the unreleased changelog for user-visible behavior changes.

## Design

`systemConfigApi.testGenerationBackend()` will pass an Axios request configuration containing a 300,000 ms timeout. The request payload and backend timeout field remain unchanged: `timeout_seconds` controls the server-side generation budget, while the Axios timeout controls how long the browser waits for the server response.

The shared Axios instance remains at 30,000 ms so ordinary API calls continue to fail promptly. This isolates the longer wait to the operation that is explicitly expected to invoke an LLM.

DeepSeek streaming will be treated as a separate diagnostic path. Existing stream-consumption and fallback tests will be inspected and extended only if they do not cover an empty stream followed by a successful non-stream retry. A provider-specific non-stream policy will not be added without a reproducible failure showing that the provider consistently returns unusable stream content.

## Error Handling

The UI continues to use the existing parsed API error categories. A genuine browser timeout after 300 seconds remains an `upstream_timeout`; backend validation and model errors continue to be returned by the smoke-test endpoint and rendered with their current structured details.

## Verification

- Observe the new frontend regression test fail before the implementation change and pass afterward.
- Run the focused system-config API tests.
- Run relevant backend stream/fallback tests when identified.
- Run Web lint and production build.
- Rebuild the static frontend served by FastAPI and perform a smoke request/page verification.

## Non-goals

- Changing the global API timeout.
- Disabling streaming for every provider.
- Altering API keys, proxy configuration, model selection, or saved user configuration.
- Committing or pushing changes without explicit authorization.
