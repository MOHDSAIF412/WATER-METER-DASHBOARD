# Checks

Two runs, no installation needed beyond Node:

```
node tests/accuracy.cjs     the water arithmetic, on real portal exports
node tests/insights.cjs     what Smart Insights concludes, on the same data
```

Both print PASS/FAIL per check and exit non-zero if anything fails.

## Why they exist

Every figure on every page comes from `usage.js`. These checks hold it to things
that must be true of a real meter, using real exports rather than invented data:

- no reading is ever dropped, and the row order from the database cannot change a total
- the cleaned register never goes backwards
- consecutive days add up **exactly** to the distance the register itself moved
- the reading shown equals the meter's own display
- the register agrees with the meter's separate flow-rate readings to under 1% over 65 days
- **every** day where the portal's daily counter disagrees has a named cause found in the
  readings — an unexplained disagreement fails the run

`insights.cjs` then checks the conclusions drawn from that data: the Golf Academy leak is
still found, the August shutdown and reopening is reported as information rather than an
alarm, a meter that has gone quiet is reported, a steady base flow is not called a leak,
and nothing half-written (`undefined`, `NaN`) reaches the words a person reads.

## The data

`fixture.json` holds real exports from the 3PhTech portal — Golf Academy every 20 minutes
for 11 weeks, 30 stables every 7 hours for 2 weeks, plus the portal's own daily figures for
two meters that have no register export. It is committed so the checks run anywhere, with
no spreadsheets and no connection.

To rebuild it from newer exports:

```
python tests/build-fixture.py "C:/Users/SAIF412/Downloads"
```

It expects the portal's own file names; see the `EXPORTS` list at the top of that script.

## Checking the live meters instead

These checks cover the arithmetic. To audit the **live** meters — every meter's readings,
gaps, register faults, and whether its days still add up — open the dashboard and use
**Data Check** in the left menu. That runs the same proofs against the platform, in the
browser, and prints a report.
