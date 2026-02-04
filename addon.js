const { addonBuilder } = require("stremio-addon-sdk");
const { execFile } = require("child_process");
const path = require("path");

const RESOLVER_BASE_URL = process.env.RESOLVER_BASE_URL || "";

/*
  Map Stremio episode IDs -> Google Drive FILE ID
  Example Stremio id for series episode: "tt0388629:1:1" (One Piece S1E1)

  From a file link like:
  https://drive.google.com/file/d/FILE_ID/view
*/
const EP_TO_DRIVE_FILE_ID = {
  // "tt0388629:1:1": "PASTE_FILE_ID_HERE",
  // "tt0388629:1:2": "PASTE_FILE_ID_HERE"
};

const manifest = {
  id: "org.stremio.onepiece.jipi",
  version: "1.0.0",
  name: "One Piece",
  description: "One Piece",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "onepiece_catalog", name: "One Piece" }],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

function runLocalYtDlpGetUrl(inputUrl) {
  return new Promise((resolve, reject) => {
    const ytdlpPath = path.join(__dirname, "bin", "dlp-jipi");

    const args = [
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f",
      "bv*+ba/b",
      "-g",
      inputUrl
    ];

    execFile(ytdlpPath, args, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message || String(err)).slice(0, 600)));
        return;
      }
      const directUrl = String(stdout).trim().split("\n").filter(Boolean)[0];
      resolve(directUrl || "");
    });
  });
}

async function resolveWithServerB(inputUrl) {
  if (!RESOLVER_BASE_URL) return "";

  const u = new URL("/resolve", RESOLVER_BASE_URL);
  u.searchParams.set("url", inputUrl);

  const res = await fetch(u.toString());
  if (!res.ok) return "";

  const data = await res.json().catch(() => null);
  if (!data || typeof data.url !== "string") return "";

  return data.url;
}

builder.defineCatalogHandler(async function (args) {
  if (args.type !== "series" || args.id !== "onepiece_catalog") {
    return { metas: [] };
  }

  return {
    metas: [
      {
        id: "tt0388629",
        type: "series",
        name: "One Piece"
      }
    ]
  };
});

builder.defineStreamHandler(async function (args) {
  const id = String(args.id || "");
  if (!id.startsWith("tt0388629")) return { streams: [] };

  const fileId = EP_TO_DRIVE_FILE_ID[id];
  if (!fileId) return { streams: [] };

  const driveUrl = "https://drive.google.com/uc?export=download&id=" + fileId;

  try {
    // Prefer Server B if configured
    let directUrl = await resolveWithServerB(driveUrl);

    // Fallback to local yt-dlp if Server B is not set or failed
    if (!directUrl) {
      directUrl = await runLocalYtDlpGetUrl(driveUrl);
    }

    if (!directUrl) return { streams: [] };

    return {
      streams: [
        {
          title: "One Piece",
          url: directUrl,
          behaviorHints: { notWebReady: true }
        }
      ]
    };
  } catch {
    return { streams: [] };
  }
});

module.exports = builder.getInterface();
