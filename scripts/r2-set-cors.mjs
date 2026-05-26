/**
 * Configure CORS on the R2 bucket so the browser can PUT directly to the
 * presigned upload URLs minted by `/api/blob/client-token`.
 *
 * If CORS is NOT configured, the browser silently aborts the PUT mid-flight
 * with a generic "Network error during upload" — there is no other surface
 * for the failure, which makes this a high-priority operational step every
 * time a new deployment origin (preview branch, custom domain, …) is added.
 *
 * Run from the project root with `.env.local` populated:
 *
 *   # Allow every origin (simplest; fine for a private app):
 *   node scripts/r2-set-cors.mjs --execute
 *
 *   # Restrict to specific origins (preferred for production):
 *   R2_ALLOWED_ORIGINS="https://example.com,https://*.vercel.app" \
 *     node scripts/r2-set-cors.mjs --execute
 *
 * Without `--execute` the script prints the policy it WOULD apply and exits.
 *
 * Equivalent one-liner with the AWS CLI (point at R2 by setting
 * `--endpoint-url $R2_ENDPOINT` and using the same R2 key pair):
 *
 *   aws s3api put-bucket-cors --bucket "$R2_BUCKET" \
 *     --endpoint-url "$R2_ENDPOINT" \
 *     --cors-configuration file://r2-cors.json
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

try {
  const envContent = readFileSync(".env.local", "utf8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] ||= match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env.local is optional — fall back to whatever env the shell provides.
}

const EXECUTE = process.argv.includes("--execute");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const R2_ENDPOINT = need("R2_ENDPOINT");
const R2_ACCESS_KEY_ID = need("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = need("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = need("R2_BUCKET");

const allowedOrigins = (process.env.R2_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsRules = [
  {
    // PUT covers presigned uploads. GET/HEAD cover any future direct browser
    // reads (e.g. if we ever publish PDFs from a custom domain instead of
    // proxying through `/api/blob/serve`).
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedOrigins: allowedOrigins,
    // `*` here lets the browser send the `Content-Type` header we set in
    // `uploadSinglePutToR2`; some browsers also include `x-amz-*` headers
    // on retries.
    AllowedHeaders: ["*"],
    // ETag is the part identifier the multipart Vercel-Blob path reads; we
    // don't strictly need it for single PUT but it's free to expose.
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

console.log(`Bucket: ${R2_BUCKET}`);
console.log(`Endpoint: ${R2_ENDPOINT}`);
console.log("Policy to apply:");
console.log(JSON.stringify({ CORSRules: corsRules }, null, 2));

try {
  const existing = await s3.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
  console.log("\nExisting policy:");
  console.log(JSON.stringify(existing.CORSRules, null, 2));
} catch (e) {
  if (e.name === "NoSuchCORSConfiguration") {
    console.log("\nExisting policy: (none)");
  } else {
    console.error("\nFailed to read existing CORS policy:", e.message);
  }
}

if (!EXECUTE) {
  console.log("\nDry-run only. Re-run with `--execute` to apply.");
  process.exit(0);
}

await s3.send(
  new PutBucketCorsCommand({
    Bucket: R2_BUCKET,
    CORSConfiguration: { CORSRules: corsRules },
  })
);
console.log("\nCORS policy applied.");
