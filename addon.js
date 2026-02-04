const { addonBuilder } = require("stremio-addon-sdk");

const B_BASE_URL = process.env.B_BASE_URL || "";

const manifest = {
  id: "org.jipi.onepiece",
  version: "1.0.0",
  name: "One Piece (Jipi)",
  description: "Streams resolved via Broker (B) and Worker (C)",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "onepiece_catalog" }],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

// Minimal catalog entry so you can find it in Stremio
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

async function callBrokerResolve(episodeId) {
  if (!B_BASE_URL) {
    throw new Error("Missing B_BASE_URL");
  }

  const u = new URL("/api/resolve", B_BASE_URL);
  u.searchParams.set("episode", episodeId);

  const r = await fetch(u.toString(), { method: "GET" });
  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
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

  return data.url;
}

builder.defineStreamHandler(async (args) => {
  try {
    // args.id for series episodes comes like: "tt0388629:1:2"
    const episodeId = String(args.id || "").trim();
    if (!episodeId) return { streams: [] };

    const directUrl = await callBrokerResolve(episodeId);

    return {
      streams: [
        {
          title: "Resolved via Jipi",
          url: directUrl,
          behaviorHints: { notWebReady: true }
        }
      ]
    };
  } catch (e) {
    return { streams: [] };
  }
});

module.exports = builder.getInterface();
