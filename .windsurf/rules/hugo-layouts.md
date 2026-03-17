# Hugo Layout Architecture — Lessons Learned

## The Problem

This Hugo site has **multiple content types** (`page`, `fatawa`, `tags`, `_default`) each with their own layout directories under `layouts/`. Hugo's template lookup order means that a content type will first look for a `baseof.html` in its own type directory (e.g., `layouts/page/baseof.html`), and if not found, may fall back to the **theme's** `_default/baseof.html` rather than the **project-level** `_default/baseof.html`.

This causes inconsistencies: changes made to the project-level `baseof.html` (like adding breadcrumbs, scripts, or partials) may not appear on pages using other content types.

## Key Content Types and Their Layout Directories

- `layouts/_default/` — default fallback for most content
- `layouts/page/` — used by content with `type: "page"` (الصوتيات, مؤلفات, الترجمة, search)
- `layouts/fatawa/` — used by content under `content/fatawa/`
- `layouts/tags/` — used by tag listing/term pages
- `layouts/index.html` — homepage only

## Rules to Follow

1. **Any change to `baseof.html`** (adding partials, scripts, meta tags, structural HTML) **must be replicated** across ALL `baseof.html` files:
   - `layouts/_default/baseof.html`
   - `layouts/page/baseof.html`
   - `layouts/fatawa/baseof.html`
   - `layouts/tags/baseof.html`

2. **Before making site-wide changes**, always check which layout types exist by listing `layouts/*/baseof.html` and ensure all are updated.

3. **When adding CSS or JS** that must load on all pages, use `layouts/partials/site-style.html` or `layouts/partials/site-scripts.html` — these are included in all `baseof.html` files. But still verify the partial is actually called from every `baseof.html`.

4. **When adding a new partial** to `<main>` or `<body>` in `baseof.html`, it must go into every type-specific `baseof.html`.

5. **Prefer putting styles in `static/css/custom.css`** over inline `<style>` blocks in partials, since `custom.css` is loaded globally via `hugo.toml` and is guaranteed to apply everywhere.

6. **Font Awesome** is loaded via JS (`defer`) in `site-style.html`. On some pages it may not render in time. For critical icons (like breadcrumb home), use inline SVGs instead.

## Quick Check Command

To verify all baseof files are in sync:
```
diff layouts/_default/baseof.html layouts/page/baseof.html
diff layouts/_default/baseof.html layouts/fatawa/baseof.html
diff layouts/_default/baseof.html layouts/tags/baseof.html
```
