const { addonBuilder } = require("stremio-addon-sdk");

const B_BASE_URL = process.env.B_BASE_URL || "";
const IMDB_ID = "tt0388629";

const manifest = {
  id: "org.jipi.onepiece",
  version: "1.0.0",
  name: "One Piece (Jipi)",
  description: "Streams resolved via Broker (B) and Worker (C)",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "onepiece_catalog", name: "One Piece" }],
  idPrefixes: [IMDB_ID]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
  if (args.type !== "series" || args.id !== "onepiece_catalog") {
    return { metas: [] };
  }

  return {
    metas: [
      {
        id: "tt0388629",
        type: "series",
        name: "One Piece",
        poster: "https://images.metahub.space/poster/medium/tt0388629/img"
      }
    ]
  };
});

function cleanTitle(filename) {
  const name = String(filename || "").trim();
  if (!name) return "";
  return name.replace(/\.mp4$/i, "");
}

async function callBrokerResolve(episodeId) {
  if (!B_BASE_URL) {
    throw new Error("Missing B_BASE_URL");
  }

  const u = new URL("/api/resolve", B_BASE_URL);
  u.searchParams.set("episode", episodeId);

  const r = await fetch(u.toString(), { method: "GET" });

  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("Broker returned non-JSON response");
  }

  if (!r.ok) {
    const msg = data && data.error ? data.error : "Broker error";
    throw new Error(msg);
  }

  if (!data.url || typeof data.url !== "string") {
    throw new Error("Broker returned missing url");
  }

  const filename = data && typeof data.filename === "string" ? data.filename : "";
  return { url: data.url, filename };
}

async function resolveEpisode(episodeId) {
  const id = String(episodeId || "").trim();
  if (!id) {
    throw new Error("Missing episode id");
  }

  const { url, filename } = await callBrokerResolve(id);
  const title = cleanTitle(filename) || "Resolved via Jipi";
  return { url, filename, title, episodeId: id };
}

builder.defineStreamHandler(async (args) => {
  if (args.type !== "series") {
    return { streams: [] };
  }

  const streamId = String(args.id || "");
  if (!streamId.startsWith(IMDB_ID)) {
    return { streams: [] };
  }

  try {
    const resolved = await resolveEpisode(streamId);

    return {
      streams: [
        {
          name: "Jipi",
          title: resolved.title,
          url: resolved.url,
          behaviorHints: { notWebReady: true }
        }
      ]
    };
  } catch {
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();
addonInterface.resolveEpisode = resolveEpisode;

module.exports = addonInterface;
