#!/bin/bash
set -e

mkdir -p bin

echo "Downloading yt-dlp for Linux..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o bin/yt-dlp

chmod +x bin/yt-dlp

echo "yt-dlp ready!"
