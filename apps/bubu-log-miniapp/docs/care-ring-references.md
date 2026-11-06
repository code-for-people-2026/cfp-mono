# Care-ring references and behavior

Care rings are a family-facing display, not diagnosis or a feeding/sleep prescription. Existing Payload `DailyStat` snapshots are read-only; this feature performs no database writes. Calibration computes a rate preview only: Apply updates the in-form draft, a separate Save persists only the local breastfeed-rate preference, and raw weights are never stored.

## Implemented completed-month milk buckets

The model uses completed Shanghai-calendar months (end-of-month anniversaries clamp to the month's last day). Buckets are: 7 days–under 3 months 500–750 ml; 3–under 5 months 800–1000 ml; 5–under 6 months 750–1000 ml; 6–under 7 months 800–1000 ml; 7–under 10 months 700–800 ml; 10–under 12 months 600–700 ml; 1–under 2 years 400–600 ml; and 2–under 5 years 300–500 ml. No automatic age reference is offered before day 7.

The 2025 NHC guidance supplies 6–7 months 800–1000, 7–9 months 700–800, 10–11 months 600–700, and 1–2 years 400–600 ml/day. Beijing's earlier public guidance supplies the younger-baby and 2-year-plus framing. The adjacent 3–5, 5–6, and 10/12-month boundaries are product consolidations, not a validated normal range.

## Sleep and output

Sleep uses WHO ranges as display bands: under 4 months 14–17 hours; 4–under 12 months 12–16 hours; 1–under 3 years 11–14 hours; and 3–under 5 years 10–13 hours per 24 hours. The six-diaper family goal is only a display target. NHS guidance about roughly six heavy wet nappies from day five refers to hydration signals, not all changes or milk volume.

## Breastfeed-rate heuristic and weighing calibration

The default 5–10 ml/minute breastfeed range is a reversible product heuristic, not a validated normal range. It is blocked when age is unknown or under 7 days; an explicit custom/calibrated choice can estimate without a birth date. Research study samples are small: one reports a mean of 8.1 ml/min across 47 dyads, and another reports 10.6 ml/min across 14 sessions.

Test weighing uses a 1.03 g/ml milk-density approximation. Home scale imprecision can exceed the measured weight difference, so results are only a rate preview with positive finite before/after weights and a positive active-feed duration.

## Sources

- Beijing Children's Hospital guidance published on the Beijing municipal health site: https://wjw.beijing.gov.cn/bmfw_20143/jkzs/jksh/202109/t20210926_2502483.html
- NHC 2025 infant feeding guidance: https://www.nhc.gov.cn/xcs/c100122/202508/8458a47948274283ab01c6cc672d8015.shtml
- WHO sleep guidelines: https://www.ncbi.nlm.nih.gov/books/NBK541173/
- NHS enough-milk guidance: https://www.nhs.uk/baby/breastfeeding-and-bottle-feeding/breastfeeding-problems/enough-milk/
- Breastfeed transfer-rate studies: https://pmc.ncbi.nlm.nih.gov/articles/PMC8476436/ and https://pmc.ncbi.nlm.nih.gov/articles/PMC10613710/
- Milk-density study: https://pmc.ncbi.nlm.nih.gov/articles/PMC11270915/
- Home-scale imprecision discussion: https://pmc.ncbi.nlm.nih.gov/articles/PMC2672832/
