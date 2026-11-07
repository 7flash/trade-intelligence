# trade-intelligence

An autonomous memecoin research agent for Solana. It tours pump.fun in a real browser, reads callouts, weighs holders, bundles and live project sites, opens range positions, and posts its own callouts with site screenshots.

It decides. It does not execute: every buy and sell comes from a range running on [solard](https://www.npmjs.com/package/@solard/sdk).

## Run

```sh
bun install
cp .env.example .env
bun run browser   # the pump.fun window
bun run agent     # the agent
bun test src
```

You need Bun, a running Solard terminal (`SOLARD_BRIDGE_URL`, `SOLARD_VIEW_URL`), and a Codex sign-in for `jsx-ai`. Sign in to pump.fun by hand in the browser it opens.

## Browser

With no Browserbase key it drives a local Edge or Chrome (`BROWSER_PATH`) over CDP, with its own blank profile.

With `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` it uses a hosted browser. `BROWSERBASE_CONTEXT_ID` keeps the sign-in between sessions. **The Browserbase path has not been run yet.**

Creator websites are never opened in the signed-in browser. Each screenshot gets its own blank session.

## Safety

- Text from web pages never reaches the model raw: only numbers, stat labels, stripped names and allowlisted phrases.
- The model holds no keys and cannot send a transaction.
- Limits are in `src/lib/agent-trader.ts`: position count, position size, and a SOL reserve.
- State stays in `.state/`, which is git-ignored.

This software trades real money and can lose all of it. It is not financial advice.
