---
name: deep-research
description: Use when the task requires thorough investigation beyond a single search — complex questions, literature reviews, competitive analysis, or trend mapping. Conduct deep, multi-step autonomous research with iterative web search, multi-source evidence gathering, cross-validation, and structured reports with citations.
---

# Deep Research

A structured methodology for conducting deep, multi-step research — inspired by the autonomous research agent paradigm from peer-reviewed research. This skill guides the model through planning, iterative retrieval, cross-validation, and synthesis into a structured report.

> Read the references when needed for detailed guidance on specific steps.

## Overview

Deep research is a multi-phase process that goes far beyond simple search-and-summarize:

```
User Query → Plan → Retrieve → Synthesize → Verify → Report
              ↓         ↓          ↓           ↓         ↓
         Decompose   Search &   Cross-      Fact-    Structured
         subtasks    Browse     Source      check    Report
                       Verify   Validate
```

**Key principles:**
- **Iterative:** Each phase can trigger new sub-queries and deeper investigation
- **Evidence-driven:** Every claim must be traceable to an external source
- **Multi-source:** Never trust a single source; cross-validate across at least 3 independent sources
- **Adaptive:** Refine the research plan based on intermediate findings

## Phase 1 — Intent Clarification & Planning

Before any searching, establish the research scope and structure.

### Step 1.1: Clarify the Research Question

If the user's query is ambiguous, ask clarifying questions. Otherwise, restate the research question in precise terms, including:
- What is the core question?
- What aspects matter most (accuracy, recency, breadth, depth)?
- What are the expected boundaries (geographic, temporal, domain-specific)?
- What format does the user want for the final output?

### Step 1.2: Decompose into Subtasks

Break the research question into 3–7 subtasks. Each subtask should:
- Be independently investigable
- Cover a distinct aspect of the overall question
- Be specific enough to guide a focused search

**Template:**
```
# Research Plan

**Research Question:** <restated question>

**Subtasks:**
1. <topic A> — <what to find>
2. <topic B> — <what to find>
3. <topic C> — <what to find>
...

**Expected Output:** <report format description>
```

Write the plan to a file named `research-plan.md` in the working directory.

## Phase 2 — Iterative Retrieval

For each subtask, execute a retrieve-query-extract cycle.

### Step 2.1: Search

For each subtask, select tools strategically based on what you need to find. Never default to a single tool.

#### Tool Selection Strategy

**Decision Matrix:**

| What am I looking for? | Primary Tool | Secondary Tool | Why |
|------------------------|--------------|----------------|-----|
| General news, articles, broad topics | `search_ddg` | — | DuckDuckGo indexes the broad web |
| Definitions, concepts, historical background | `search_wikipedia` | `search_ddg` | Wikipedia provides structured overviews |
| Programming Q&A, debugging, code patterns | `search_stackoverflow` | `search_github` | Stack Overflow has curated developer answers |
| JavaScript/Node.js packages, ecosystem | `search_npm` | `search_github` | npm has package metadata; GitHub has source |
| Source code, repositories, developer topics | `search_github` | `search_ddg` | GitHub has code, issues, commits, README |
| Current events, pricing, recent data | `search_ddg` | — | Only web search has real-time data |
| Library migration guides, best practices | `search_stackoverflow` | `search_github` | Developers share migration experiences |
| Package size, dependencies, version history | `search_npm` | — | npm registry has full package metadata |
| Checking if a repo is maintained | `search_github` | — | Commits, issues, PRs show activity |
| Academic papers, research | `search_ddg` | `search_wikipedia` | Web search finds papers; Wikipedia contextualizes |

**Negative cases (when NOT to use a tool):**
- Current pricing data → use `search_ddg`, NOT `search_wikipedia` (Wikipedia is often outdated)
- Recent security vulnerabilities → use `search_ddg` + `search_github`, NOT `search_wikipedia`
- Framework comparison → use `search_ddg` + `search_github`, NOT `search_npm` (npm doesn't compare frameworks)
- Library best practices → use `search_stackoverflow` + `search_github`, NOT `search_ddg` (broader web is noisier)

**Multi-Tool Requirement:** For each subtask, use at least 2 different search tools when the question has multiple dimensions.

| Complexity | Tool Count | Example |
|------------|-----------|---------|
| Simple factual (single dimension) | 1 tool | "What year was React released?" → `search_wikipedia` |
| Moderate (2+ dimensions) | 2 tools | "Is MedusaJS viable?" → `search_ddg` + `search_github` |
| Complex investigation | 3+ tools | "Evaluate Node.js CMS options" → `search_ddg` + `search_github` + `search_npm` + `search_stackoverflow` |

**When to use multiple tools:**
- The subtask has more than one aspect (e.g., "is X viable" = popularity + quality + community)
- You need to cross-validate a claim
- One tool's results are insufficient for the question
- Different tools surface different evidence types (e.g., npm shows package size, GitHub shows activity)

**When a single tool is sufficient:**
- The question is narrow and factual
- One tool is the canonical source (e.g., "What's the latest version of X?" → `search_npm`)
- The other tools would return redundant information

**Pre-Search Checklist** — before running any search round:
- [ ] **Which tools are relevant?** Match the subtask to the decision matrix above
- [ ] **Am I using only one tool?** If yes, would a second tool add value?
- [ ] **What am I trying to verify?** Each tool should answer a different aspect
- [ ] **Is there a negative case?** Am I avoiding tools that would give poor results?
- [ ] **Will I cross-validate?** Do I have at least 2 sources for significant claims?

**Available Tools:**

| Tool | Best For | Data Type |
|------|----------|-----------|
| `search_ddg` | Broad web, news, current data | Web pages, articles, forums |
| `search_wikipedia` | Definitions, concepts, history | Encyclopedic overviews |
| `search_stackoverflow` | Code patterns, debugging, best practices | Developer Q&A |
| `search_npm` | JavaScript packages, ecosystem | Package metadata, registry |
| `search_github` | Repositories, code, project health | Source code, issues, commits |
| `henyo_fetch` | Extract content from specific URLs | Full page content |

**Source Credibility Priority** — when evaluating results from any tool, prioritize sources in this order:
1. **Primary sources** — official documentation, academic papers, government publications
2. **Secondary sources** — established news outlets, well-known industry publications
3. **Community sources** — forums, blogs, social media (with lower credibility)

This priority applies regardless of which tool returned the result.

### Step 2.2: Extract & Summarize

For each source, extract:
- Key facts and data points
- Direct quotes (with attribution)
- Contradictory or conflicting claims
- Gaps or uncertainties

Write findings to a file named `findings/NN-topic.md` for each subtask (e.g., `findings/01-market-size.md`).

### Step 2.3: Iterate on Findings

After each subtask's initial search:
1. Review what was found
2. Identify gaps or surprising findings
3. Generate follow-up queries if needed
4. Document follow-up searches as `findings/NN-topic-followup.md`

**Never stop at the first round of results.** A thorough investigation requires at least 2-3 rounds of iterative searching per subtopic, each with progressively refined queries.

### Step 2.4: Cross-Source Validation

For each significant claim or data point:
1. Identify at least 3 independent sources
2. Check for agreement or disagreement
3. Note the credibility hierarchy of sources
4. Flag any claims that could not be verified

Add a `## Verification` section to each findings file with this template:
```markdown
## Verification

| Claim | Source 1 | Source 2 | Source 3 | Status |
|-------|----------|----------|----------|--------|
| <claim> | ✅ agrees | ✅ agrees | ✅ agrees | **Confirmed** |
| <claim> | ✅ agrees | ❌ disagrees | ⚠️ unclear | **Disputed** |
| <claim> | ⚠️ unclear | ⚠️ unclear | ⚠️ unclear | **Unverified** |
```

## Phase 3 — Synthesis

Synthesize all findings into a coherent narrative.

### Step 3.1: Map Evidence to Claims

Create a mapping file `findings/evidence-map.md`:
```markdown
# Evidence Map

## Claim: <statement>
- **Evidence for:** <cite sources>
- **Evidence against:** <cite sources>
- **Confidence:** High / Medium / Low
- **Key source:** <best single source>

## Claim: <statement>
...
```

### Step 3.2: Identify Gaps

List what could not be found and why:
- Information that was not available online
- Conflicting information that could not be resolved
- Areas requiring specialized knowledge or access
- Temporal limitations (outdated data, future predictions)

Write to `findings/gaps.md`:
```markdown
# Research Gaps

1. <gap description> — <why it matters> — <attempted approaches>
2. ...
```

### Step 3.3: Structure the Narrative

Organize findings into a logical structure:
- **Executive Summary** — Key findings and conclusions (1-2 paragraphs)
- **Introduction** — Context, scope, and methodology
- **Main Findings** — Thematic sections based on subtasks
- **Analysis** — Synthesis, patterns, and implications
- **Limitations** — Gaps and uncertainties
- **Conclusion** — Direct answer to the research question
- **References** — Full citation list

## Phase 4 — Report Generation

Produce the final report with full citations.

### Report Format

Write to `research-report.md`:

```markdown
# <Title>

## Executive Summary
<Brief overview of key findings>

## Introduction
<Context, scope, research question>

## Methodology
<Brief description of research approach and sources used>

## Findings

### <Section 1>
<Detailed findings with inline citations [1], [2], etc.>

### <Section 2>
...

## Analysis
<Patterns, trends, implications>

## Limitations
<Uncertainties, gaps, data quality issues>

## Conclusion
<Direct, comprehensive answer to the research question>

## References
1. <Full citation — title, author, date, URL>
2. ...

## Appendix: Evidence Verification
<Summary table of cross-source validation>
```

### Citation Standards

- Use numbered citations `[1]`, `[2]`, etc.
- Reference list at the end with full details
- Include: Title, Author(s), Date, Source/URL
- For academic papers: Include arXiv ID, DOI, or preprint link
- For web pages: Include full URL and access date
- For social media: Include author handle, date, and URL

## Execution Notes

### Workflow in pi

1. **Planning:** Write plan file, confirm with user
2. **Retrieval:** For each subtask, use the Tool Selection Strategy (decision matrix above) to pick tools. Use at least 2 different tools when the question has multiple dimensions. Run tools in parallel when possible. Use `henyo_fetch` to extract content from promising URLs. Use `write`/`edit` for findings.
3. **Synthesis:** Cross-reference all findings, identify gaps
4. **Report:** Generate the final structured report

### When to Use This Skill

- Complex research questions requiring multiple sources
- Competitive analysis or market research
- Literature reviews on technical topics
- Fact-checking multi-part claims
- Trend analysis across industries
- Technical deep-dives on emerging topics

### When NOT to Use This Skill

- Simple factual questions (one search suffices)
- Code debugging or implementation help
- Creative writing tasks
- Tasks with very tight deadlines

## References

For more detailed guidance, read these reference files:

- [Evidence Collection Patterns](references/evidence-collection.md)
- [Source Credibility Guide](references/source-credibility.md)
- [Report Templates](references/report-templates.md)