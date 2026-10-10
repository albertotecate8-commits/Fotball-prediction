#!/usr/bin/env bash
# Compila para GitHub Pages (https://albertotecate8-commits.github.io/Fotball-prediction/).
# - 404.html: cualquier ruta del enrutador carga la app.
# - Copias reales de las rutas que abren los enlaces de correo (responden 200).
set -euo pipefail
cd "$(dirname "$0")/.."
VITE_BASE=/Fotball-prediction/ npx vite build
cp dist/index.html dist/404.html
for d in auth/confirmar restablecer entrar registro; do mkdir -p "dist/$d"; cp dist/index.html "dist/$d/index.html"; done
touch dist/.nojekyll
if grep -rqE 'localhost:(3000|5173|5179)' dist; then echo 'ERROR: el build contiene una URL local' >&2; exit 1; fi
