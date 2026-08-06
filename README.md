# Signal

AI that reads a small business's own numbers and returns a plain-language briefing:
what's moving, what stands out, what to watch, and what to do next.

## Run it
1. Deploy to Vercel (or any Node serverless host).
2. Set an environment variable `ANTHROPIC_API_KEY` with your Anthropic API key.
3. Open the site. The sample dataset is loaded by default — hit **Analyze**.
4. Upload your own CSV (any columns) to analyze real data.

## Files
- `index.html` — the tool (upload, preview, briefing). Sample data baked in.
- `api/analyze.js` — serverless function; sends the data to the model, returns structured insights.
- `sample.csv` — the built-in demo dataset, as a file you can re-upload or edit.

The analysis is grounded only in the numbers you provide — it computes real
comparisons and won't invent figures.
