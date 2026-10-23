# Visualization model

These pure functions consume the existing sunmer-home Payload read models in `legacy` mode and the shared records projection in `sidecar` mode. They do not create records, alter Payload collections, or calculate persisted DailyStats.

- In `legacy` mode, `summarizeHomeDay` and `summarizeRecordList` intentionally retain the old, different calculation rules. Both use truncated minutes; the backend DailyStats uses rounded minutes. Trends and heatmaps use the server's saved totals verbatim.
- The `legacy` urine card retains `large + ceil((small + medium) / 2)`. Its diaper trend uses the saved raw diaper count.
- Timeline positions use logical pixels at 60 pixels per hour. Horizontal positions and week blocks use percentages. The rendering layer scales positions to its physical dimensions.
- The old weekly categories remain sleep, feeding (including pumping), diaper, and the six duration-based activities. Other activity types remain visible in the day timeline and record details.

Deliberate presentation corrections during migration:

- All dates use modern China time, UTC+8, instead of the device timezone. The UTC plugin avoids an `Intl.DateTimeFormat` dependency in WeChat runtimes. Historical Chinese daylight-saving dates before 1992 are outside this newborn diary's date model.
- Midnight point events are visible in the week view. The web component's strict interval test accidentally excluded them.
- Day blocks outside the selected day's interval are omitted. Old unfinished records returned by the server no longer create a misleading minimum-height block at midnight or outside the grid.
- Missing burping results are not rendered as failures; explicit `false` still displays “未成功”.
- Low-saturation color tokens adapt the original type colors to the new visual design without changing the statistics.

Incomplete sleep records still receive the old minimum day/week visual block and are excluded from completed-sleep totals. No elapsed sleep total is invented.

In `sidecar` mode, `records.ts` renders the server's `/api/app/records/snapshot` summary rather than recalculating home/list cards. Daily-stat responses carry the same projection plus `coverage` and `byType`. Cards show actual diaper counts and preserve explicit zero; metric-specific known counts keep unknown amounts and ongoing activity from becoming zero points in trends/heatmaps. Unfinished feeding and pumping show “进行中” rather than requesting a final amount. Pending revisions do not erase the last saved fact, while suspected new duplicates remain outside definite totals. Explicitly ongoing sleep remains in the next day's coverage until the current time; elapsed estimates are never completed-sleep totals. A newly observed end from the old site supersedes stale ongoing metadata for display and statistics, without rewriting the audit history.
