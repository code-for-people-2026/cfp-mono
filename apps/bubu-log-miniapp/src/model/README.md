# Visualization model

These pure functions consume the existing sunmer-home Payload read models. They do not create records, alter Payload collections, or calculate persisted DailyStats.

- `summarizeHomeDay` and `summarizeRecordList` intentionally retain the old, different calculation rules. Both use truncated minutes; the backend DailyStats uses rounded minutes. Trends and heatmaps use the server's saved totals verbatim.
- The urine card retains `large + ceil((small + medium) / 2)`. The diaper trend uses the saved raw diaper count.
- Timeline positions use logical pixels at 60 pixels per hour. Horizontal positions and week blocks use percentages. The rendering layer scales positions to its physical dimensions.
- The old weekly categories remain sleep, feeding (including pumping), diaper, and the six duration-based activities. Other activity types remain visible in the day timeline and record details.
- `calendarPeriod` is the single pure source for the central title, fetched bounds and next-step limit. `stepPeriod` clamps month steps to the target month's last day and never enters the future. Week periods start Monday; month periods run first–last. `millisecondsUntilNextShanghaiDay` supplies the page-level midnight tick without changing the selected date.
- `buildHeatmap` uses a natural Shanghai calendar month, not a rolling four-week window. Its Monday-first grid always contains the complete month in four, five or six rows. Leading/trailing padding is neutral, noninteractive, excluded from maxima and never marked as missing data. Future in-month days expose no statistics.
- Sleep and outdoor records render as full-width background bands. Foreground overlap lanes are computed only from foreground records, so a pump during sleep stays full width when nothing else overlaps. `layoutDayTimeline` and `buildWeek` accept a visual minimum (`minBlockHeightMinutes` / `minBlockHeightPercent`) derived from the measured canvas and current zoom; the same height is used for lane collision and rendering. Background bands keep their true clipped height and instant rules stay a line.
- Week labels show only the recorded measurement (`120ml`, `7h`, `10m`, `3次`) instead of the start clock or a type-name prefix; the short type name is used only when no measurement exists. In overlapping week lanes, `weekBlockLabelParts` lets the component stack the number over the unit, and `buildWeek` gives measurement lanes slightly more width while reserving the same two-line visual minimum for collision layout. Three-way overlaps remain physically bounded: text-only labels may truncate, but quantities and units are not concatenated or rewritten. The full activity label and time range remain accessible and in the tap-to-open detail sheet. A cross-midnight timed record is clipped per calendar column, so its label and block describe that column's segment; the stored DailyStat is untouched. Null/undefined and explicit zero remain distinct.

Deliberate presentation corrections during migration:

- All dates use modern China time, UTC+8, instead of the device timezone. The UTC plugin avoids an `Intl.DateTimeFormat` dependency in WeChat runtimes. Calendar arithmetic uses the shifted UTC clock rather than `utcOffset`, so a host daylight-saving transition cannot repeat a date. Historical Chinese daylight-saving dates before 1992 are outside this newborn diary's date model.
- Midnight point events are visible in the week view. The web component's strict interval test accidentally excluded them.
- Day blocks outside the selected day's interval are omitted. Old unfinished records returned by the server no longer create a misleading minimum-height block at midnight or outside the grid.
- Missing burping results are not rendered as failures; explicit `false` still displays “未成功”.
- `activityDetails` keeps core care fields and the separate notes field only. Creation/update timestamps and audit provenance belong to the detail's collapsed “更多信息” section; notes are never relabeled as original speech.
- Low-saturation color tokens adapt the original type colors to the new visual design without changing the statistics.

Incomplete sleep records still receive the old minimum day/week visual block and are excluded from completed-sleep totals. No elapsed sleep total is invented.
