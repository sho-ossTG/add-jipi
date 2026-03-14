function renderLandingPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>One Piece (Jipi) - Stremio Addon</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('https://images3.alphacoders.com/134/1342304.jpeg') no-repeat center center fixed; background-size: cover; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; }
        .container { background: rgba(0, 0, 0, 0.8); padding: 3rem; border-radius: 15px; max-width: 500px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
        h1 { margin-top: 0; margin-bottom: 1rem; font-size: 2.5rem; }
        p { margin-bottom: 1rem; opacity: 0.9; font-size: 1.1rem; line-height: 1.6; }
        .install-btn { display: inline-block; background-color: #8A5BB8; color: white; padding: 0.6rem 1.4rem; text-decoration: none; font-weight: bold; border-radius: 6px; margin-top: 1.5rem; transition: transform 0.2s, background 0.3s; font-size: 0.85rem; letter-spacing: 1px; }
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
