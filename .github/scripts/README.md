# Profile language charts

The profile uses two generated SVGs: a tall desktop donut and a shorter mobile donut.
Both put the current leading language and its percentage in the centre.

The generator reads GitHub's public repository and language-byte endpoints. It includes
owned, non-forked public repositories only. Percentages use all collected language bytes;
languages beyond the first six are combined as **Other** rather than omitted from the total.
This measures repository code size, not proficiency, contribution authorship, or time spent.

No packages or private-repository credentials are needed. With Node 22 or later:

```sh
node --test .github/scripts/tests/generate-language-charts.test.mjs
node .github/scripts/generate-language-charts.mjs
```

Public API rate limits apply. In Actions, the workflow uses the automatically supplied
`GITHUB_TOKEN`; do not paste tokens into source files. The token is sent only to GitHub's API.

`.github/workflows/language-charts.yml` runs daily at 06:17 UTC, on relevant generator
changes pushed to `main`, or manually through **Actions → Refresh language charts → Run workflow**.
It tests first, generates both charts, then commits changed assets as `github-actions[bot]`.
A failed request or invalid/empty data fails the refresh instead of publishing partial results.
Failed workflow runs leave the previous committed SVGs visible. Pushes are never forced.

The workflow starts working after these files are pushed and GitHub Actions is enabled.
The profile repository must permit the workflow's requested `contents: write` permission.
