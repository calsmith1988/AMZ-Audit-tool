# Amazon Ads Audit Tool (Prototype)

This prototype is a static web app that parses Amazon bulk sheets and outputs
audit summaries for Sponsored Products, Sponsored Brands, and Sponsored Display.

## How to run

1. Open `index.html` in a browser.
2. Upload your Amazon bulk sheet (.xlsx).
3. Review mappings (optional) and explore the dashboard.

## Column mapping

- The app auto-maps columns, but you can adjust mappings per sheet.
- Download your mapping JSON and re-upload it later to reapply quickly.

## Notes

- ACoS is computed from spend and sales.
- CVR is computed from orders and clicks.
- Search term uniqueness uses a keyword/ASIN set derived from the bulk sheet.

## Tests

- Open `tests/index.html` in a browser to run the aggregation checks.
- Test fixtures live in `tests/fixtures`.
