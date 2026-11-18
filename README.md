# Filims Bot — Movie Image Hash API

Cloudflare Worker that accepts JPEG bytes and returns a 64-bit perceptual image hash (pHash). Use the **same endpoint** for both channel posters saved by the bot and photos uploaded by users.

## Deploy through Cloudflare dashboard

1. Open **Workers & Pages** in Cloudflare.
2. Choose **Create application → Worker → Connect to Git**.
3. Select `gusjaqdo1-a11y/Filims-bot`.
4. Set the production branch to `main` and root directory to `/`.
5. Set the build/deploy command to `npm run deploy` (Cloudflare installs dependencies from `package.json`).
6. Complete the connection and wait for the deployment.

You can also deploy with Wrangler:
```bash
npm install
npx wrangler login
npx wrangler deploy
```

## Set the API secret

In Cloudflare: **Worker → Settings → Variables and Secrets → Add → Secret**.

- Name: `API_SECRET`
- Value: generate a long random secret and keep it private.

Do not commit the secret to GitHub or put it in bot source code.

## Test

After deployment, copy the Worker URL, for example:

`https://movie-image-hash.YOUR-SUBDOMAIN.workers.dev`

Health check:

```bash
curl https://movie-image-hash.YOUR-SUBDOMAIN.workers.dev/health
```

Hash a JPEG:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@poster.jpg" \
  https://movie-image-hash.YOUR-SUBDOMAIN.workers.dev/hash
```

Successful response:

```json
{
  "ok": true,
  "hash": "0123456789abcdef",
  "width": 600,
  "height": 900,
  "algorithm": "phash-64-v1"
}
```

## Bot integration contract

Send the raw JPEG bytes as the request body:

- URL: `https://YOUR-WORKER-URL/hash`
- Method: `POST`
- Headers: `Authorization: Bearer YOUR_API_SECRET`, `Content-Type: image/jpeg`
- Body: raw `Uint8Array` returned by Telegram's file download API.

Read `response.hash` and save it to `movie_posts.image_hash`. Use this exact API for both channel-post ingestion and user image searches. Existing rows with null or invalid hashes need to be reprocessed before they can match.

## Important limits

- Accepts JPEG only; Telegram `message.photo` images are JPEG.
- Maximum upload size: 8 MB.
- Maximum decoded image size: 6 megapixels.
- Cloudflare Workers Free currently allows 100,000 requests/day but only 10 ms CPU time per request. Pure-JavaScript JPEG decoding can exceed that CPU allowance for some images. Test with real Telegram posters after deployment; if the Worker returns a CPU-limit error, this decoder workload needs a runtime with a higher CPU allowance or a different image-processing service.
