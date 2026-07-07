import fs from "node:fs/promises";
import path from "node:path";

import {
  buildFeedReview,
  ManualJsonGrandTourFeedProvider,
  parseFeedArgs
} from "./grandtour-feed-provider.mjs";

async function main() {
  const options = parseFeedArgs(process.argv.slice(2));
  const provider = new ManualJsonGrandTourFeedProvider({ sourceFile: options.sourceFile });
  const payload = await provider.readPayload();
  const mode = options.apply ? "apply" : "dry-run";
  const review = buildFeedReview({ payload, mode });

  await fs.mkdir(path.dirname(options.reportPath), { recursive: true });
  await fs.writeFile(options.reportPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...review, reportPath: options.reportPath }, null, 2));

  if (options.apply) {
    throw new Error("Feed apply is intentionally disabled until a provider/source is approved. Review was written; no database tables were mutated.");
  }
}

await main();
