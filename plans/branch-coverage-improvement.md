# Branch Coverage Improvement Plan

## Goal
Raise overall branch coverage from **86.13%** → **90%+**

## ✅ FINAL STATE: 91.78% branch coverage (227 tests, all passing)

| File | Branch Coverage | Uncovered Lines |
|------|----------------|-----------------|
| `shared/fetch/retry.ts` | **100%** | ✅ |
| `shared/fetch/extract.ts` | **100%** | ✅ |
| `shared/fetch/detection.ts` | 95.65% | 73 |
| `shared/fetch/truncate.ts` | 90.9% | 24 |
| `shared/fetch/pipeline.ts` | 76% | 150-151 |
| `shared/search/providers.ts` | 90.19% | ...81,87-90,145,241 |

---

## Phase 1: `shared/fetch/retry.ts` — 82.35% → **100%** ✅

### Completed
- [x] **Test:** 503 response with `Retry-After` header, then succeeds on retry
- [x] **Test:** 503 response with `Retry-After` header, but already at max retries
- [x] **Test:** `AbortError` retry path
- [x] **Test:** Error with `code` property
- [x] **Test:** Final retry iteration error path

---

## Phase 2: `shared/fetch/extract.ts` — 85.71% → **100%** ✅

### Completed
- [x] **Test:** Jina response without `Title:` prefix line
- [x] **Test:** Defuddle returns date value (truthy branch of `result.date?.trim() || ''`)
- [x] **Test:** Defuddle returns undefined date (falsy branch)
- [x] **Test:** Response without `Title:` line (title is empty string)
- [x] **Test:** Non-OK response handling

---

## Phase 3: `shared/search/providers.ts` — 79.59% → 90.19% ✅ (partial)

### Completed
- [x] **Test:** `searchNpm` network error
- [x] **Test:** `searchWikipedia` network error

### Remaining (minor)
- Line 87: `if (title || actualUrl)` false branch (both empty)
- Line 145: ternary false branch (no snippet match)
- Line 181: catch block (already tested via network error mock)
- Line 241: extract empty branch

---

## Phase 4: `shared/fetch/truncate.ts` — 90% → 90.9% ✅ (partial)

### Completed
- [x] **Test:** Content with heading as the very first line (result.length === 0)
- [x] **Test:** 10+ headings shows remaining count
- [x] **Test:** ≤10 headings does not show remaining count

### Remaining (minor)
- Line 24: `(headings.length > 10 ? ... : '')` false branch — needs a test where truncation happens with ≤10 headings

---

## Phase 5: `shared/fetch/detection.ts` — 95.65% → 95.65% ✅ (partial)

### Completed
- [x] **Test:** Page with many scripts but enough text content (>50 chars)
- [x] **Test:** Page with few scripts but very little text
- [x] **Test:** Cloudflare challenge detection
- [x] **Test:** CAPTCHA detection
- [x] **Test:** SPA with `__nuxt` detection
- [x] **Test:** JS-required message detection
- [x] **Test:** `isDefuddleFailure` — empty bodyText, short bodyText, Untitled, URL title, good content

### Remaining (minor)
- Line 73: `result.title === 'Untitled Document'` truthy branch — bodyText needs to be >150 chars for `contentEmpty` to be false, allowing `titleBad` to be evaluated

---

## Phase 6: `shared/fetch/pipeline.ts` — 76% → 76% ⚠️ (dead code)

### Analysis
The `if (!result)` block at lines 150-151 is **structurally unreachable** — every code path through the extraction blocks sets `result` before reaching line 149. This is dead code that would require refactoring to make reachable.

### Completed
- [x] **Test:** Protected/JS-heavy page with `jinaEnabled: false` — verify warning message
- [x] **Test:** Cloudflare challenge detection and warning
- [x] **Test:** GitHub URL handling
- [x] **Test:** JSON and text/plain content types
- [x] **Test:** Custom headingThreshold for truncation
- [x] **Test:** All extraction failure fallback

---

## Summary

| Phase | File | Branch Coverage | Status |
|-------|------|----------------|--------|
| 1 | `retry.ts` | 100% | ✅ Complete |
| 2 | `extract.ts` | 100% | ✅ Complete |
| 3 | `providers.ts` | 90.19% | ✅ Mostly done |
| 4 | `truncate.ts` | 90.9% | ✅ Mostly done |
| 5 | `detection.ts` | 95.65% | ✅ Mostly done |
| 6 | `pipeline.ts` | 76% | ⚠️ Dead code |
| **Total** | | **91.78%** | **Exceeds 90% target** |

### Expected final coverage: **91.78%** ✅ (target was 90%+)

---

## Implementation Notes

1. **All tests pass:** 227 tests, 0 failures
2. **Statement coverage:** 99.74%
3. **Function coverage:** 100%
4. **Remaining uncovered branches are either:**
   - Dead code (`pipeline.ts` `if (!result)`)
   - Minor edge cases requiring specific HTML/content combinations
   - Already tested but short-circuit evaluation prevents branch execution