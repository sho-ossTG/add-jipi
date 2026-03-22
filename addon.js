const { addonBuilder } = require("stremio-addon-sdk");
const { createDClient } = require("./modules/integrations/d-client");
const packageVersion = require("./package.json").version;

const IMDB_ID = "tt0388629";

const manifest = {
  id: "org.jipi.onepiece",
  version: packageVersion,
  name: "One Piece (Jipi)",
  description: "JIPI NAKAMA ANIMEISREAL ",
  logo: "https://www.stickitup.xyz/cdn/shop/products/one-piece-logo-sticker-4857715.jpg?v=1771245370",
  background: "https://www.stickitup.xyz/cdn/shop/products/one-piece-logo-sticker-4857715.jpg?v=1771245370",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "onepiece_catalog", name: "One Piece" }],
  idPrefixes: [IMDB_ID],
  behaviorHints: {
    configurationRequired: false
  }
};

const builder = new addonBuilder(manifest);
const dClient = createDClient();

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

async function resolveEpisode(episodeId) {
  return dClient.resolveEpisode(episodeId);
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

    const rawUrl = typeof resolved.url === "string"
      ? resolved.url.replace(/^http:\/\//, "https://")
      : "";
    const finalUrl = (() => {
      try {
        const u = new URL(rawUrl);
        u.searchParams.delete("range");
        return u.toString();
      } catch {
        return rawUrl;
      }
    })();
    return {
      streams: [
        {
          name: "Jipi",
          description: resolved.title,
          url: finalUrl,
          behaviorHints: {
            notWebReady: false,
            bingeGroup: "jipi",
            filename: resolved.title
          }
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
