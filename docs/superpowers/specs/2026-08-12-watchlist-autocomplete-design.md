# Watchlist Autocomplete Design

## Goal

Add stock-code/name matching to the Home watchlist quick-add field without changing the top search field or triggering analysis.

## Behavior

- Reuse the existing `StockAutocomplete` index, suggestion list, keyboard navigation, IME handling, and fallback input.
- Selecting a suggestion submits its canonical stock code directly to `onAddToWatchlist` and clears the quick-add field after success.
- Typing a valid code and pressing Enter or clicking the plus button keeps the existing manual-add behavior.
- Selection never calls `submitAnalysis`, changes the selected report, or starts an analysis task.
- Failed additions retain the current input through the existing watchlist action feedback path.

## Scope

Only the Home watchlist workspace and its focused tests change. The API, top search box, analysis pipeline, and watchlist persistence contract remain unchanged.

## Verification

- Component test proves selecting a matched stock calls only `onAddToWatchlist` with its canonical code.
- Existing watchlist workspace tests continue to pass.
- Web lint and production build pass.
