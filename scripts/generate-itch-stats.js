const fs = require("node:fs/promises");
const path = require("node:path");

const API_URL = process.env.ITCH_API_URL || "https://itch.io/api/1/key/my-games";
const API_KEY = process.env.ITCH_API_KEY || process.env.ITCHIO_API_KEY;
const OUTPUT_PATH = path.join(process.cwd(), "assets", "itch-stats.svg");

async function main() {
  if (!API_KEY) {
    throw new Error(
      "Missing ITCH_API_KEY. Set it in your shell or as a GitHub Actions secret named ITCH_API_KEY."
    );
  }

  const response = await fetch(API_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`itch.io API request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`itch.io API error: ${payload.errors.join(", ")}`);
  }

  const games = Array.isArray(payload.games) ? payload.games : [];

  const normalizedGames = games.map((game) => ({
    title: String(game.title ?? "Untitled Game"),
    downloads: numberOrZero(game.download_count ?? game.downloads_count),
    views: numberOrZero(game.view_count ?? game.views_count),
    coverUrl: typeof game.cover_url === "string" ? game.cover_url : "",
  }));

  for (const game of normalizedGames) {
    console.log(
      `${game.title} | downloads=${game.downloads} | views=${game.views} | cover_url=${game.coverUrl || "none"}`
    );
  }

  const [brandIcon, iconData] = await Promise.all([
    loadOptionalBrandIcon(),
    Promise.all(
      normalizedGames.map(async (game) => ({
        ...game,
        embeddedCover: game.coverUrl ? await fetchAsDataUri(game.coverUrl) : "",
      }))
    ),
  ]);

  const totalDownloads = normalizedGames.reduce((sum, game) => sum + game.downloads, 0);
  const totalViews = normalizedGames.reduce((sum, game) => sum + game.views, 0);

  const svg = buildSvg({
    totalDownloads,
    totalViews,
    games: iconData,
    brandIcon,
  });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, svg, "utf8");

  console.log(`Saved ${OUTPUT_PATH}`);
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

async function loadOptionalBrandIcon() {
  const candidates = [
    path.join(process.cwd(), "itchio.png"),
    path.join(process.cwd(), "assets", "itchio.png"),
    path.join(process.cwd(), "itch.png"),
    path.join(process.cwd(), "assets", "itch.png"),
  ];

  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      const extension = path.extname(candidate).toLowerCase();
      const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
      return `data:${mimeType};base64,${buffer.toString("base64")}`;
    } catch {
      // Optional asset, keep falling back.
    }
  }

  return "";
}

async function fetchAsDataUri(url) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Skipping cover fetch for ${url}: ${response.status} ${response.statusText}`);
      return "";
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn(`Skipping cover fetch for ${url}: ${error.message}`);
    return "";
  }
}

function buildSvg({ totalDownloads, totalViews, games, brandIcon }) {
  const formatter = new Intl.NumberFormat("en-US");
  const padding = 30;
  const iconSize = 64;
  const iconGap = 16;
  const totalIconWidth =
    games.length === 0 ? 0 : games.length * iconSize + Math.max(0, games.length - 1) * iconGap;
  const width = Math.max(920, padding * 2 + Math.max(740, totalIconWidth + 72));
  const height = 336;
  const cardY = 116;
  const cardHeight = 112;
  const cardWidth = 340;
  const cardGap = 24;
  const cardsStartX = (width - (cardWidth * 2 + cardGap)) / 2;
  const trayY = 242;
  const trayHeight = 84;
  const trayWidth = width - padding * 2;
  const iconStartX = padding + Math.max(24, (trayWidth - totalIconWidth) / 2);
  const badgeWidth = 178;
  const badgeX = width - padding - badgeWidth - 18;
  const title = "itch.io";
  const coverClipDefs = [];

  const headerBadge = brandIcon
    ? `
    <g filter="url(#cardShadow)">
      <rect x="${padding}" y="32" width="72" height="72" rx="22" fill="url(#brandTile)" stroke="#ff8a8f" stroke-opacity="0.55" />
      <image href="${brandIcon}" x="${padding}" y="32" width="72" height="72" preserveAspectRatio="xMidYMid meet" />
    </g>`
    : `
    <g filter="url(#cardShadow)">
      <rect x="${padding}" y="32" width="72" height="72" rx="22" fill="url(#brandTile)" stroke="#ff8a8f" stroke-opacity="0.55" />
      <text x="${padding + 36}" y="77" text-anchor="middle" fill="#fff5f5" font-size="18" font-weight="700">itch.io</text>
    </g>`;

  const coverTrayContent =
    games.length === 0
      ? `<text x="${width / 2}" y="${trayY + 49}" text-anchor="middle" fill="#fca5a5" font-size="15">No games returned by the API.</text>`
      : games
          .map((game, index) => {
            const x = iconStartX + index * (iconSize + iconGap);
            const clipId = `game-cover-${index}`;
            const titleId = `game-title-${index}`;
            const label = escapeXml(game.title);
            coverClipDefs.push(
              `<clipPath id="${clipId}"><rect x="${x}" y="${trayY + 9}" width="${iconSize}" height="${iconSize}" rx="15" ry="15" /></clipPath>`
            );

            if (game.embeddedCover) {
              return `
    <g aria-labelledby="${titleId}">
      <title id="${titleId}">${label}</title>
      <rect x="${x - 3}" y="${trayY + 6}" width="${iconSize + 6}" height="${iconSize + 6}" rx="18" fill="url(#iconGlow)" opacity="0.32" />
      <image href="${game.embeddedCover}" x="${x}" y="${trayY + 9}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />
      <rect x="${x}" y="${trayY + 9}" width="${iconSize}" height="${iconSize}" rx="15" ry="15" fill="none" stroke="#ff8c92" stroke-opacity="0.75" />
    </g>`;
            }

            return `
    <g aria-labelledby="${titleId}">
      <title id="${titleId}">${label}</title>
      <rect x="${x - 3}" y="${trayY + 6}" width="${iconSize + 6}" height="${iconSize + 6}" rx="18" fill="url(#iconGlow)" opacity="0.28" />
      <rect x="${x}" y="${trayY + 9}" width="${iconSize}" height="${iconSize}" rx="15" ry="15" fill="#1a1014" stroke="#ff8c92" stroke-opacity="0.75" />
      <text x="${x + iconSize / 2}" y="${trayY + 46}" text-anchor="middle" fill="#fff1f2" font-size="21" font-weight="700">${escapeXml(
                initialsForTitle(game.title)
              )}</text>
    </g>`;
          })
          .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="itch-title itch-desc">
  <title id="itch-title">${title}</title>
  <desc id="itch-desc">Total itch.io downloads and views with game cover icons shown on a scarlet red dark themed card.</desc>
  <defs>
    <linearGradient id="cardBg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#06070b" />
      <stop offset="0.52" stop-color="#0c0b12" />
      <stop offset="1" stop-color="#190b10" />
    </linearGradient>
    <linearGradient id="brandTile" x1="${padding}" y1="32" x2="${padding + 72}" y2="104" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ff4555" />
      <stop offset="1" stop-color="#b3122d" />
    </linearGradient>
    <linearGradient id="lineAccent" x1="${padding}" y1="0" x2="${width - padding}" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ff6670" />
      <stop offset="0.5" stop-color="#ff2e43" />
      <stop offset="1" stop-color="#ff9a72" />
    </linearGradient>
    <linearGradient id="panelStroke" x1="0" y1="${cardY}" x2="${width}" y2="${cardY + cardHeight}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ff8994" stop-opacity="0.7" />
      <stop offset="0.5" stop-color="#ff3b4f" stop-opacity="0.85" />
      <stop offset="1" stop-color="#ff8b5d" stop-opacity="0.7" />
    </linearGradient>
    <linearGradient id="panelFill" x1="0" y1="${cardY}" x2="0" y2="${cardY + cardHeight}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#161019" stop-opacity="0.95" />
      <stop offset="1" stop-color="#0f0c12" stop-opacity="0.95" />
    </linearGradient>
    <radialGradient id="glowLeft" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(160 18) rotate(50) scale(220 180)">
      <stop stop-color="#ff4555" stop-opacity="0.62" />
      <stop offset="1" stop-color="#ff4555" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glowRight" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${width - 110} ${height - 18}) rotate(180) scale(230 160)">
      <stop stop-color="#ff6c4d" stop-opacity="0.34" />
      <stop offset="1" stop-color="#ff6c4d" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="iconGlow" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#ff4757" />
      <stop offset="1" stop-color="#ff8c69" />
    </linearGradient>
    <filter id="blurGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="34" />
    </filter>
    <filter id="cardShadow" x="-20%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="20" flood-color="#000000" flood-opacity="0.38" />
    </filter>
    ${coverClipDefs.join("\n    ")}
  </defs>
  <rect width="${width}" height="${height}" rx="30" fill="#05060a" />
  <circle cx="160" cy="18" r="170" fill="url(#glowLeft)" filter="url(#blurGlow)" />
  <circle cx="${width - 110}" cy="${height - 18}" r="170" fill="url(#glowRight)" filter="url(#blurGlow)" />
  <rect x="6" y="6" width="${width - 12}" height="${height - 12}" rx="24" fill="url(#cardBg)" stroke="#39202a" stroke-width="1.4" />
  <rect x="${padding}" y="20" width="${width - padding * 2}" height="4" rx="2" fill="url(#lineAccent)" />
${headerBadge}
  <text x="${padding + 96}" y="79" fill="#fff5f5" font-size="34" font-weight="700">${title}</text>
  <g>
    <rect x="${badgeX}" y="38" width="${badgeWidth}" height="34" rx="17" fill="#170d12" stroke="#5b2430" />
    <circle cx="${badgeX + 24}" cy="55" r="6" fill="#ff4b5b" />
    <text x="${badgeX + 38}" y="60" fill="#ffe4e6" font-size="13" font-weight="700">LIVE GAME METRICS</text>
  </g>
  <g filter="url(#cardShadow)">
    <rect x="${cardsStartX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="28" fill="url(#panelFill)" stroke="url(#panelStroke)" />
    <text x="${cardsStartX + 26}" y="${cardY + 32}" fill="#fda4af" font-size="13" font-weight="700" letter-spacing="1">TOTAL DOWNLOADS</text>
    <text x="${cardsStartX + 26}" y="${cardY + 79}" fill="#fff5f5" font-size="42" font-weight="700">${formatter.format(
    totalDownloads
  )}</text>
  </g>
  <g filter="url(#cardShadow)">
    <rect x="${cardsStartX + cardWidth + cardGap}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="28" fill="url(#panelFill)" stroke="url(#panelStroke)" />
    <text x="${cardsStartX + cardWidth + cardGap + 26}" y="${cardY + 32}" fill="#fda4af" font-size="13" font-weight="700" letter-spacing="1">TOTAL VIEWS</text>
    <text x="${cardsStartX + cardWidth + cardGap + 26}" y="${cardY + 79}" fill="#fff5f5" font-size="42" font-weight="700">${formatter.format(
    totalViews
  )}</text>
  </g>
  <g filter="url(#cardShadow)">
    <rect x="${padding}" y="${trayY}" width="${trayWidth}" height="${trayHeight}" rx="24" fill="#120c12" stroke="#5e2632" />
  </g>
${coverTrayContent}
</svg>`;
}

function initialsForTitle(title) {
  return String(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
