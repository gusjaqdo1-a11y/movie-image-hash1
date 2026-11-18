import jpeg from "jpeg-js";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 6_000_000;
const HASH_SIZE = 32;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    },
  });
}

function isJpeg(bytes) {
  return bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Keep this algorithm identical for channel posters and user search images.
function perceptualHash(image) {
  const { width, height, data } = image;

  if (!width || !height || width * height > MAX_PIXELS) {
    throw new Error("Image dimensions are not supported");
  }

  const gray = new Float64Array(HASH_SIZE * HASH_SIZE);

  for (let y = 0; y < HASH_SIZE; y++) {
    const py = Math.min(height - 1, Math.floor((y * height) / HASH_SIZE));

    for (let x = 0; x < HASH_SIZE; x++) {
      const px = Math.min(width - 1, Math.floor((x * width) / HASH_SIZE));
      const i = (py * width + px) * 4;
      gray[y * HASH_SIZE + x] =
        0.299 * data[i] +
        0.587 * data[i + 1] +
        0.114 * data[i + 2];
    }
  }

  const cosX = Array.from({ length: 8 }, (_, u) =>
    Float64Array.from({ length: HASH_SIZE }, (_, x) =>
      Math.cos(((2 * x + 1) * u * Math.PI) / 64)
    )
  );
  const cosY = Array.from({ length: 8 }, (_, v) =>
    Float64Array.from({ length: HASH_SIZE }, (_, y) =>
      Math.cos(((2 * y + 1) * v * Math.PI) / 64)
    )
  );

  const coefficients = new Float64Array(64);
  let index = 0;

  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;

      for (let y = 0; y < HASH_SIZE; y++) {
        const rowOffset = y * HASH_SIZE;
        const cy = cosY[v][y];

        for (let x = 0; x < HASH_SIZE; x++) {
          sum += gray[rowOffset + x] * cosX[u][x] * cy;
        }
      }

      coefficients[index++] = sum;
    }
  }

  const threshold = median(Array.from(coefficients.slice(1)));
  let hex = "";

  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) {
      nibble = (nibble << 1) | (coefficients[i + bit] >= threshold ? 1 : 0);
    }
    hex += nibble.toString(16);
  }

  return hex;
}

function authenticate(request, env) {
  const secret = env.API_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "movie-image-hash", version: 1 });
    }

    if (request.method !== "POST" || url.pathname !== "/hash") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    if (!authenticate(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return json({ ok: false, error: "Image is too large (8 MB maximum)" }, 413);
    }

    try {
      const bytes = new Uint8Array(await request.arrayBuffer());

      if (!bytes.length) {
        return json({ ok: false, error: "Image body is empty" }, 400);
      }
      if (bytes.length > MAX_UPLOAD_BYTES) {
        return json({ ok: false, error: "Image is too large (8 MB maximum)" }, 413);
      }
      if (!isJpeg(bytes)) {
        return json({
          ok: false,
          error: "Only JPEG images are supported. Send Telegram photo bytes, not a file URL.",
        }, 415);
      }

      const decoded = jpeg.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: true,
        maxResolutionInMP: 6,
        maxMemoryUsageInMB: 32,
      });

      const hash = perceptualHash(decoded);

      return json({
        ok: true,
        hash,
        width: decoded.width,
        height: decoded.height,
        algorithm: "phash-64-v1",
      });
    } catch (error) {
      console.error("Image hash failed:", error?.message || error);
      return json({
        ok: false,
        error: "Could not decode this JPEG image",
      }, 422);
    }
  },
};
