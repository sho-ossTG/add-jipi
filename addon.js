const { addonBuilder } = require("stremio-addon-sdk");
const { createBrokerClient } = require("./modules/integrations/broker-client");

const IMDB_ID = "tt0388629";

const manifest = {
  id: "org.jipi.onepiece",
  version: "1.0.0",
  name: "One Piece (Jipi)",
  description: "JIPI NAKAMA ANIMEISREAL ",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "onepiece_catalog", name: "One Piece" }],
  idPrefixes: [IMDB_ID]
};

const builder = new addonBuilder(manifest);
const brokerClient = createBrokerClient();

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
  return brokerClient.resolveEpisode(episodeId);
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
