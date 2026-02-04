const { addonBuilder } = require("stremio-addon-sdk");
const magnet = require("magnet-uri");
const { execFile } = require("child_process");
const path = require("path");

const manifest = {
  id: "org.stremio.helloworld",
  version: "1.0.0",
  name: "Hello World Addon",
  description: "Sample addon providing a few public domain movies",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "helloworldmovies" },
    { type: "series", id: "helloworldseries" }
  ],
  idPrefixes: ["tt"]
};

const dataset = {
  "tt0032138": { name: "The Wizard of Oz", type: "movie", infoHash: "24c8802e2624e17d46cd555f364debd949f2c81e", fileIdx: 0 },
  "tt0017136": { name: "Metropolis", type: "movie", infoHash: "dca926c0328bb54d209d82dc8a2f391617b47d7a", fileIdx: 1 },
  "tt0063350": fromMagnet("Night of the Living Dead", "movie",
    "magnet:?xt=urn:btih:A7CFBB7840A8B67FD735AC73A373302D14A7CDC9"),
  "tt0051744": { name: "House on Haunted Hill", type: "movie", infoHash: "9f86563ce2ed86bbfedd5d3e9f4e55aedd660960" },
  "tt1254207": { name: "Big Buck Bunny", type: "movie", url: "http://clips.vorwaerts-gmbh.de/big_buck_bunny.mp4" },

  // THIS ONE USES yt-dlp
  "tt0031051": { name: "The Arizona Kid", type: "movie", ytId: "m3BKVSpP80s" }
};

function fromMagnet(name, type, uri) {
  const parsed = magnet.decode(uri);
  const infoHash = parsed.infoHash.toLowerCase();
  return {
    name,
    type,
    infoHash,
    sources: (parsed.announce || []).map(x => "tracker:" + x).concat(["dht:" + infoHash])
  };
}

const builder = new addonBuilder(manifest);

function runYtDlpGetUrl(inputUrl) {
  return new Promise((resolve, reject) => {
    const ytdlpPath = path.join(__dirname, "bin", "yt-dlp");

    const args = [
      "-g",
      "--no-playlist",
      "-f",
      "bv*+ba/b",
      inputUrl
    ];

    execFile(ytdlpPath, args, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      const directUrl = String(stdout).trim().split("\n")[0];
      resolve(directUrl);
    });
  });
}

builder.defineStreamHandler(async function (args) {
  const item = dataset[args.id];
  if (!item) return { streams: [] };

  if (item.ytId) {
    const ytUrl = `https://www.youtube.com/watch?v=${item.ytId}`;

    try {
      const directUrl = await runYtDlpGetUrl(ytUrl);

      return {
        streams: [
          {
            title: "YouTube via yt-dlp",
            url: directUrl
          }
        ]
      };
    } catch (e) {
      return {
        streams: [
          {
            title: "yt-dlp ERROR",
            url: "about:blank",
            behaviorHints: { notWebReady: true }
          }
        ]
      };
    }
  }

  return { streams: [item] };
});

const METAHUB_URL = "https://images.metahub.space";

function generateMetaPreview(value, key) {
  const imdbId = key.split(":")[0];
  return {
    id: imdbId,
    type: value.type,
    name: value.name,
    poster: METAHUB_URL + "/poster/medium/" + imdbId + "/img"
  };
}

builder.defineCatalogHandler(function (args) {
  const metas = Object.entries(dataset)
    .filter(([_, value]) => value.type === args.type)
    .map(([key, value]) => generateMetaPreview(value, key));

  return Promise.resolve({ metas });
});

module.exports = builder.getInterface();
