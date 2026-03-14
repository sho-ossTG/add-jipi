function renderLandingPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>One Piece (Jipi) - Stremio Addon</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: url('https://images3.alphacoders.com/134/1342304.jpeg') no-repeat center center fixed; background-size: cover; color: white; display: flex; justify-content: center; align-items: flex-end; height: 100vh; text-align: center; }
        .container { background: rgba(0, 0, 0, 0.65); padding: 1rem 2rem; width: 100%; box-sizing: border-box; }
        h1 { margin: 0 0 0.2rem 0; font-size: 1.3rem; }
        p { margin: 0 0 0.6rem 0; opacity: 0.85; font-size: 0.85rem; }
        .install-btn { display: inline-block; background-color: #8A5BB8; color: white; padding: 0.45rem 1.2rem; text-decoration: none; font-weight: bold; border-radius: 6px; transition: transform 0.2s, background 0.3s; font-size: 0.8rem; letter-spacing: 1px; }
        .install-btn:hover { background-color: #7a4ba8; transform: scale(1.05); }
    </style>
</head>
<body>
    <div class="container">
        <h1>One Piece Jipi</h1>
        <p>thanks to: Animeisreal and Nakama</p>
        <a href="stremio://add-jipi.vercel.app/manifest.json" class="install-btn">INSTALL ADDON</a>
    </div>
    <script>
      window.si = window.si || function(){(window.si.q=window.si.q||[]).push(arguments)};
    </script>
    <script defer src="/_vercel/speed-insights/script.js"></script>
</body>
</html>
  `.trim();
}

function projectPublicHealth() {
  return { status: "OK" };
}

module.exports = {
  renderLandingPage,
  projectPublicHealth
};
