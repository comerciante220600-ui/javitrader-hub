# JaviTrader — Worker de avisos (Web Push)

Backend mínimo en Cloudflare Workers que gestiona las suscripciones y envía las
notificaciones push. El frontend (campana + panel) vive en el repo del hub
(`sw.js`, `avisos.js`, y el markup en `index.html`).

## Piezas

- `src/index.js` — el Worker (rutas `/subscribe`, `/unsubscribe`, `/send`, `/vapidPublicKey`).
- `wrangler.toml` — config (binding KV `SUBS`, variables públicas).
- Cifrado Web Push (VAPID ES256 + aes128gcm) hecho a mano con WebCrypto: **sin dependencias**.

## Despliegue (F2) — pasos

Requiere una cuenta de Cloudflare (la misma del dominio) y `wrangler`.

```bash
cd worker
npm install
npx wrangler login              # abre el navegador para autenticar

# 1) Crear el almacén de suscripciones
npx wrangler kv namespace create SUBS
#   -> copia el "id" que devuelve y pégalo en wrangler.toml (kv_namespaces.id)

# 2) Cargar los secretos (NO van en git)
npx wrangler secret put VAPID_PUBLIC_KEY
#   pega: BACfEkT2OaDS0BPLBViSrIx1pa07QZEeII2Uwy3KQkAbpG4_z7e39Sb7rMgj5ni0BekKEHafccgg3hnLKeJbHU8
npx wrangler secret put VAPID_PRIVATE_KEY
#   pega la privada (la tiene Javier / Claude en la sesión; NUNCA se commitea)
npx wrangler secret put ADMIN_TOKEN
#   inventa un token largo aleatorio (p. ej. `openssl rand -base64 32`)

# 3) Desplegar
npx wrangler deploy
```

Tras el deploy tendrás una URL tipo `https://javitrader-avisos.<sub>.workers.dev`.
Opcional: rutar un dominio propio `avisos.javitrader.net` desde el panel de Cloudflare.

## Enganchar el frontend

1. En `avisos.js` (repo hub), rellena `WORKER_URL` con la URL del Worker.
2. Copia `sw.js` y `avisos.js` al repo que sirve la raíz de `javitrader.net`
   (`javitrader-bio`), junto con el `index.html` actualizado. **`sw.js` debe
   estar en la raíz** para tener alcance sobre todo el sitio.

## Categorías (deben coincidir en los 3 sitios)

`novedades`, `comunidad`, `macro`, `formacion`
(definidas en `src/index.js`, `avisos.js` y `avisos-admin.html`).

## Enviar un aviso

Abre `avisos-admin.html`, mete la URL del Worker + el `ADMIN_TOKEN`, elige
categoría, título y texto, y envía. Solo le llega a quien tenga esa categoría
activada.

## Notas de escala

- El envío recorre KV con `list` paginado (1000/página) y filtra por metadata.
  Suficiente para miles de suscriptores. Si crece mucho, migrar a índices por
  categoría o a D1.
- Las suscripciones caducadas (404/410) se borran solas al enviar.
