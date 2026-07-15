# CLAUDE.md — JaviTrader Hub

> Léelo entero antes de tocar nada.

Web escaparate único de la comunidad **JaviTrader**. Es la puerta de entrada que
presenta todos los productos (comunidad gratis, señales, cartera TAA, formación,
herramientas) y enlaza a donde ya vive cada cosa. **No** es una plataforma
todo-en-uno: es un hub ligero, foco en organización e imagen profesional.

**En vivo en https://javitrader.net**

---

## 1. Qué es esto

- Sitio **estático** de una sola página principal (`index.html`) más una página
  de resultados (`track-record.html`). Sin backend, sin build, sin framework.
- Objetivo: presentar la marca con registro institucional ("banca privada"),
  canalizar hacia la comunidad gratuita de Telegram y los servicios, y exponer
  los enlaces de afiliado a los exchanges (BingX / Bitunix).
- El login real y las áreas privadas viven fuera: el botón "Iniciar sesión"
  apunta a `https://app.javitrader.net` (otra app, otro repo).

## 2. Stack y arquitectura

- **HTML + CSS puro**, escrito a mano. Todo el CSS va inline en un `<style>`
  dentro de cada `.html`. Sin JS propio (salvo `<details>` nativo para el FAQ).
- Dependencias externas por CDN (solo en `index.html`):
  - Fuentes Google: **Newsreader** (serif editorial) e **Inter** (texto).
  - Iconos: **@tabler/icons-webfont** vía jsDelivr.
- `track-record.html` es autónoma: su propio `<style>`, fuentes del sistema, sin
  CDN. Muestra el track record etiquetado como **BACKTEST** (Swing 1D +105%,
  Intradía 4h +305%, combinada +732%, ~58% de aciertos).

### Estructura de carpetas

```
javitrader-hub/
├── index.html          # landing principal (hero, servicios, enfoque, exchanges, FAQ)
├── track-record.html   # resultados en backtest (autónoma)
├── logo.png            # monograma JT dorado/negro (marca de cabecera y footer)
├── og-image.jpg        # imagen Open Graph / Twitter Card (1200x675)
├── bingx.svg           # logo BingX (tarjeta de exchange)
└── bitunix.png         # logo Bitunix (tarjeta de exchange)
```

### Secciones clave de `index.html`

- `header` sticky con marca, nav y botones (Iniciar sesión / Acceso abierto).
- `#hero` — titular "Los mercados, leídos con método" + barra de confianza.
- `#servicios` — grid de tarjetas con badges **Activo** / **Próximamente** /
  **Requiere acceso**: Acceso abierto, Señales, Cartera TAA, Formación,
  Herramientas, El enfoque.
- `#enfoque` — los tres pilares del método.
- `#brokers` — Exchanges de confianza (BingX/Bitunix) con gancho "−20%
  comisiones" y nota de patrocinio/afiliado.
- `#faq` — preguntas frecuentes anti-hype.
- `final` + `footer` — CTA, RRSS, disclaimer legal y enlaces legales.

### Enlaces cableados (revisar si cambian)

- Comunidad: `t.me/COMUNIDADJAVITRADER` · Bot señales: `t.me/javitrader_senales_bot`
- Afiliados: `bingxdao.com/partner/JaviTrade` · `bitunix.com/register?vipCode=JaviTrader`
- RRSS: `@javintrader` (IG/X/TikTok/Threads) · YouTube `@javitraderr`
- App/login: `app.javitrader.net`

## 3. Despliegue

- Repo: **`comerciante220600-ui/javitrader-hub`** (remote `origin`, rama `main`).
- Hosting: **GitHub Pages**. No hay build ni workflow en `.github/`; Pages sirve
  los ficheros estáticos directamente. Publicar = commit + push a `main`.
- **Ojo (duplicidad):** el dominio `javitrader.net` (CNAME + DNS en Cloudflare)
  y ficheros como `calculadora.html`, `privadidad/terminos/cookies.html` y el
  `CNAME` **NO están en este repo**; viven en el repo hermano de la bio
  (`comerciante220600-ui/javitrader-bio`), donde también se pegó el `index.html`.
  Este repo es la **fuente/preview** del landing. Un cambio del hub puede
  requerir actualizar **ambos** repos hasta que se consoliden en uno.
- Cambios importantes o irreversibles: proponer y esperar visto bueno de Javier.
  No commitear ni pushear salvo que lo pida explícitamente.

## 4. Diseño / marca

- Estética **"Oscura · Banca privada"**: negro (`--bg:#0A0A0C`) + dorado contenido
  (`--gold:#B89357`), serif editorial **Newsreader**, registro institucional
  (estilo banco de inversión, no "creador de contenido").
- Copy de **usted**, tono **anti-hype**, sin exclamaciones ni promesas.
- Paleta y tipografía viven en las variables `:root` de cada `.html`. Mantener la
  coherencia entre `index.html` y `track-record.html` (tienen tokens propios).
- **Método = ANÁLISIS TÉCNICO** + contexto fundamental / actualidad.
  **NO es on-chain.** Ignorar cualquier referencia a "on-chain" en notas viejas:
  era de un motor de contenido ya retirado. No introducir lenguaje on-chain.

## 5. Reglas / Principios

- **No exponer claves ni tokens** (API keys de Cloudflare/GitHub/exchanges) en
  código, commits, logs ni capturas. Este sitio es estático y público: no debe
  contener ningún secreto.
- **No prometer rentabilidades.** Nada de "x100", garantías ni predicciones. Todo
  resultado numérico debe ir etiquetado (p. ej. **BACKTEST**) y ser verificable.
- **Disclaimers obligatorios.** Mantener el aviso legal del footer (riesgo de
  pérdida, rentabilidades pasadas ≠ futuras, no es asesoramiento financiero) y
  los enlaces legales. No debilitar ese lenguaje.
- **Afiliados con transparencia.** Los enlaces a exchanges son de patrocinio;
  mantener visible la nota de afiliación.
- **Nada de auto-trading ni mover dinero** desde este proyecto.
- Idioma de todo el contenido y de los commits: **español** (neutro/profesional).
