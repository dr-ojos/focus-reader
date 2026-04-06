# FocusReader

Lector de enfoque estilo Speechify — resalta cada palabra y el párrafo activo mientras avanza la lectura.

## Stack

- **Next.js 14** (App Router)
- **React 18** + TypeScript
- **PDF.js** (vía CDN) — extracción de texto de PDF
- **JSZip** (vía CDN) — parseo de EPUB (ZIP con HTML adentro)

## Estructura del proyecto

```
src/
  app/
    layout.tsx       — Root layout con metadata
    page.tsx         — Página principal
    globals.css      — Reset CSS global
  components/
    FocusReader.tsx  — Componente principal (toda la UI y lógica de playback)
  lib/
    parsers.ts       — Parsers de PDF, EPUB y modelo de párrafos
```

## Instalación y desarrollo

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Funcionalidades actuales

- ✅ Carga de **PDF**, **EPUB** y **TXT** (drag & drop o botón)
- ✅ Modo **Scroll** — texto completo con resaltado de palabra (ámbar pastel) y párrafo (azul pastel)
- ✅ Modo **Spritz** — una palabra a la vez centrada, con ORP (Optimal Recognition Point)
- ✅ Control de velocidad: botones − / + (±25 ppm), campo numérico editable, teclas ↑↓
- ✅ Teclado: Espacio = play/pause, ←→ = saltar ±10 palabras
- ✅ Tamaño de fuente S/M/L/XL (modo scroll)
- ✅ Modo oscuro / claro
- ✅ Barra de progreso y tiempo restante estimado
- ✅ Sin movimiento de texto al resaltar (solo cambia color/fondo, no tamaño)

## Mejoras pendientes sugeridas para Claude Code

- [ ] Persistencia de progreso por libro (localStorage)
- [ ] Selector de capítulos para EPUB (tabla de contenidos)
- [ ] Resaltado de oración completa además del párrafo
- [ ] Exportar posición/progreso
- [ ] PWA / instalable como app
- [ ] Soporte de voz (Text-to-Speech sincronizado)
- [ ] Ajuste de margen de lectura
- [ ] Estadísticas de sesión (palabras leídas, tiempo, velocidad promedio)

## Notas técnicas

### Parseo de EPUB
Un EPUB es un ZIP. El flujo es:
1. `META-INF/container.xml` → encuentra el `.opf`
2. `.opf` → lee el `<spine>` para el orden de capítulos
3. Cada archivo HTML del spine → extrae texto limpio preservando saltos de párrafo
4. Fallback: si no hay OPF, busca todos los `.xhtml`/`.html` del ZIP ordenados por nombre

### Modelo de párrafos
Los párrafos se representan como `{ startIdx, endIdx }` sobre el array global de palabras.
Las palabras se derivan con `words.slice(startIdx, endIdx + 1)` en tiempo de render.
Esto evita duplicación de datos y el bug `para.words is undefined`.

### Sin layout shift
El resaltado de palabra nunca cambia `fontSize` ni `fontWeight` — solo `backgroundColor` y `color`.
