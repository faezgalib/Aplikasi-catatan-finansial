# Catatan Finansial

A web app (PWA) for recording monthly spending. Paste your notes, each item is sorted into its category automatically, and the dashboard shows the same figures as the *Personal monthly budget* Excel template: projected vs actual, a donut chart per category, saving to income ratio, fixed cost ratio and food & groceries ratio.

## Main features

- **Input from notes**: one item per line, e.g. `Kopi 35000`, `Bensin 150rb`, `Listrik 503.000`, `Nabung 20jt`.
  - Supported amount formats: `35000`, `35.000`, `35,000`, `35rb`, `35k`, `1,5jt`, `1.5 juta`, `Rp 35.000`.
  - Optional dates: `12/11 sate 45k`, or a heading line such as `12 Nov` that applies to the lines below it.
  - Lines starting with `+` are recorded as income (`+ Gaji 70jt`).
  - Several items in one line: `kopi 25rb, roti 15rb`.
- **Automatic categories**: keywords are tried first. Corrections you make are remembered, so the same item is recognized next time.
- **AI (Claude)** only for items not recognized by keywords (optional, needs an API key).
- **Share from the Notes app** (Android): after installing the app, select text in Notes → *Share* → *Catatan Finansial*.
- **Excel export** (.xlsx): a Summary sheet, one sheet per month (same layout as the template) and a Transactions sheet.
- **Budget**: projected cost per item, multiple income sources, previous savings balance, editing categories/items/keywords. A new month automatically copies the previous month's projections.
- **Works offline**, data is stored only in this device's browser. Use *Download backup* regularly.

## Running locally

```bash
npm start          # http://localhost:8080
npm test           # parser tests
```

## Hosting (GitHub Pages)

1. Open the repo *Settings → Pages*, set **Source: GitHub Actions**.
2. Merge to `main`. The `Deploy ke GitHub Pages` workflow runs the tests and then publishes.
3. Open the Pages URL in Chrome Android → menu ⋮ → **Install app / Add to Home screen**.

Note: GitHub Pages for a private repo requires a paid GitHub plan. An alternative is Netlify/Cloudflare Pages (just upload this folder, no build step needed).

## File structure

| File | Contents |
|---|---|
| `js/parser.js` | Reads notes → amounts, dates, categories (pure, tested in `tests/`) |
| `js/defaults.js` | Default categories, items, projections and keywords |
| `js/store.js` | localStorage storage and the monthly summary calculations |
| `js/app.js` | User interface |
| `js/ai.js` | Categorization via the Claude API |
| `js/export.js` | Excel export |
| `vendor/` | SheetJS (xlsx 0.18.5) and the Anthropic SDK (1.2.0) bundled for the browser |

## Calculation definitions (same as the Excel template)

- Total actual expense = all categories, **including** Savings.
- Balance this month = actual income − total actual expense.
- Saving to income = *Saving* category ÷ actual income.
- Fixed cost (non food) = categories of type *Fixed cost* ÷ actual income (default: Housing, Transportation, Education).
- Food & groceries = categories of type *Food* ÷ actual income (default: Groceries, Food & Beverage).

Category types can be changed in the Budget menu.
