"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { parsePdf, parseEpub, buildParagraphs, type Paragraph } from "@/lib/parsers";
import styles from "./FocusReader.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_WPM = 50;
const MAX_WPM = 800;
const FONT_SIZE_LABELS = ["S", "M", "L", "XL"];
const FONT_SIZE_VALUES = ["1rem", "1.125rem", "1.3rem", "1.6rem"];

// ─── Component ────────────────────────────────────────────────────────────────
export default function FocusReader() {
  // State
  const [words, setWords]           = useState<string[]>([]);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [wpm, setWpm]               = useState(250);
  const [wpmInput, setWpmInput]     = useState("250");
  const [fontSizeIdx, setFontSizeIdx] = useState(1);
  const [fileName, setFileName]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Procesando…");
  const [mode, setMode]             = useState<"scroll" | "spritz">("scroll");
  const [progress, setProgress]     = useState(0);
  const [darkMode, setDarkMode]     = useState(true);

  // Refs
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const wordRefs    = useRef<(HTMLSpanElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const msPerWord = (60 / wpm) * 1000;

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "scroll") return;
    const el = wordRefs.current[currentIdx];
    if (el && containerRef.current) {
      const container = containerRef.current;
      const targetScroll = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
      container.scrollTo({ top: targetScroll, behavior: "smooth" });
    }
  }, [currentIdx, mode]);

  // ── Progress ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (words.length > 1)
      setProgress(Math.round((currentIdx / (words.length - 1)) * 100));
  }, [currentIdx, words.length]);

  // ── Playback engine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentIdx((prev) => {
          if (prev >= words.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, msPerWord);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, msPerWord, words.length]);

  // ── Speed helpers ─────────────────────────────────────────────────────────
  const setSpeed = useCallback((val: number) => {
    const v = Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(val)));
    setWpm(v);
    setWpmInput(String(v));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); setIsPlaying((p) => !p); }
      if (e.code === "ArrowUp")    { e.preventDefault(); setSpeed(wpm + 25); }
      if (e.code === "ArrowDown")  { e.preventDefault(); setSpeed(wpm - 25); }
      if (e.code === "ArrowRight") setCurrentIdx((p) => Math.min(words.length - 1, p + 10));
      if (e.code === "ArrowLeft")  setCurrentIdx((p) => Math.max(0, p - 10));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [wpm, words.length, setSpeed]);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file) return;
    setLoading(true);
    setFileName(file.name);
    setIsPlaying(false);
    setWords([]);
    setParagraphs([]);
    wordRefs.current = [];

    try {
      let rawText = "";
      if (file.name.endsWith(".pdf")) {
        setLoadingMsg("Extrayendo texto del PDF…");
        rawText = await parsePdf(await file.arrayBuffer());
      } else if (file.name.endsWith(".epub")) {
        setLoadingMsg("Descomprimiendo EPUB…");
        rawText = await parseEpub(await file.arrayBuffer());
        if (rawText.length < 50) throw new Error("No se pudo extraer texto del EPUB.");
      } else {
        setLoadingMsg("Leyendo archivo…");
        rawText = (await file.text()).trim();
      }

      const { words: w, paragraphs: p } = buildParagraphs(rawText);
      setWords(w);
      setParagraphs(p);
      setCurrentIdx(0);
      setProgress(0);
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : "Error desconocido";
      const { words: w, paragraphs: p } = buildParagraphs(
        `Error al leer el archivo: ${errMsg}`
      );
      setWords(w);
      setParagraphs(p);
    }

    setLoading(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  // ── Playback controls ─────────────────────────────────────────────────────
  const togglePlay = () => {
    if (currentIdx >= words.length - 1) setCurrentIdx(0);
    setIsPlaying((p) => !p);
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const currentParaIdx = paragraphs.findIndex(
    (p) => currentIdx >= p.startIdx && currentIdx <= p.endIdx
  );

  const minutesLeft = Math.ceil((words.length - currentIdx) / wpm);

  // ── Readers ───────────────────────────────────────────────────────────────
  const renderSpritz = () => {
    const word = words[currentIdx] || "";
    const orp  = Math.max(1, Math.floor(word.length * 0.35));
    return (
      <div className={styles.spritzReader}>
        <div className={styles.spritzCard}>
          <div className={styles.spritzWord}>
            <span className={styles.spritzBefore}>{word.slice(0, orp)}</span>
            <span className={styles.spritzOrp}>{word[orp] || ""}</span>
            <span className={styles.spritzAfter}>{word.slice(orp + 1)}</span>
          </div>
        </div>
        <div className={styles.spritzMeta}>
          <span className={styles.spritzProgress}>
            {currentIdx + 1} / {words.length}
          </span>
          <span>·</span>
          <span>{wpm} ppm</span>
          <span>·</span>
          <span className={styles.statsTime}>{minutesLeft} min</span>
        </div>
      </div>
    );
  };

  const renderScroll = () => (
    <div
      ref={containerRef}
      className={styles.scrollReader}
    >
      {paragraphs.map((para, pIdx) => {
        const isCurrentPara = pIdx === currentParaIdx;
        const paraWords = words.slice(para.startIdx, para.endIdx + 1);
        if (!paraWords.length) return null;
        return (
          <p
            key={pIdx}
            className={`${styles.paragraph} ${isCurrentPara ? styles.active : ""}`}
            style={{ fontSize: FONT_SIZE_VALUES[fontSizeIdx] }}
          >
            {paraWords.map((word, wOff) => {
              const absIdx = para.startIdx + wOff;
              const isCurrent = absIdx === currentIdx;
              const isPast    = absIdx < currentIdx;
              let wordClass = styles.word;
              if (isCurrent) wordClass += ` ${styles.current}`;
              else if (isPast) wordClass += ` ${styles.past}`;
              return (
                <span
                  key={absIdx}
                  ref={(el) => { wordRefs.current[absIdx] = el; }}
                  onClick={() => { setCurrentIdx(absIdx); setIsPlaying(true); }}
                  className={wordClass}
                >
                  {word}{" "}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div
      className={`${styles.app} ${darkMode ? styles.dark : styles.light}`}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>📖</div>
          <span className={styles.logoText}>FocusReader</span>
          {fileName && (
            <span className={styles.fileName} title={fileName}>{fileName}</span>
          )}
        </div>

        <div className={styles.controls}>
          {/* Mode toggle */}
          <div className={styles.segmented} role="group" aria-label="Modo de lectura">
            {(["scroll", "spritz"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`${styles.segBtn} ${mode === m ? styles.active : styles.inactive}`}
                aria-pressed={mode === m}
              >
                {m === "scroll" ? "📜 Scroll" : "⚡ Spritz"}
              </button>
            ))}
          </div>

          {/* Font size */}
          {mode === "scroll" && (
            <div className={styles.fontSizeBtns} role="group" aria-label="Tamaño de fuente">
              {FONT_SIZE_LABELS.map((lbl, i) => (
                <button
                  key={i}
                  onClick={() => setFontSizeIdx(i)}
                  className={`${styles.fontSizeBtn} ${fontSizeIdx === i ? styles.active : styles.inactive}`}
                  aria-label={`Fuente tamaño ${lbl}`}
                  aria-pressed={fontSizeIdx === i}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}

          {/* Dark mode */}
          <button
            onClick={() => setDarkMode((d) => !d)}
            className={styles.iconBtn}
            aria-label={darkMode ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>

          {/* Upload */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className={styles.uploadBtn}
            aria-label="Subir archivo"
          >
            <span>+</span> Subir
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.epub,.txt"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </div>
      </header>

      {/* ── Progress bar ── */}
      {words.length > 0 && (
        <div className={styles.progressBar} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* ── Main content ── */}
      <main className={styles.main}>
        {/* Loading */}
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span className={styles.loadingText}>{loadingMsg}</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && words.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📄</div>
            <h1 className={styles.emptyTitle}>Sube un archivo para comenzar</h1>
            <p className={styles.emptyDesc}>
              FocusReader resalta cada palabra mientras avanzas,<br />
              manteniendo tu atención en la lectura.
            </p>
            <div className={styles.emptyFormats}>
              <span className={styles.badge}>PDF</span>
              <span className={styles.badge}>EPUB</span>
              <span className={styles.badge}>TXT</span>
            </div>
            <div className={styles.emptyDrop}>
              <span>🖱️</span>
              <span>Arrastra tu archivo aquí</span>
            </div>
          </div>
        )}

        {/* Reader */}
        {!loading && words.length > 0 && (
          mode === "scroll" ? renderScroll() : renderSpritz()
        )}
      </main>

      {/* ── Controls bar ── */}
      {words.length > 0 && !loading && (
        <div className={styles.controlsBar}>
          {/* Playback */}
          <div className={styles.playbackGroup}>
            <button
              onClick={() => { setIsPlaying(false); setCurrentIdx(0); }}
              className={styles.ctrlBtn}
              title="Reiniciar"
              aria-label="Reiniciar lectura"
            >
              ⏮
            </button>
            <button
              onClick={() => setCurrentIdx((p) => Math.max(0, p - 20))}
              className={styles.ctrlBtn}
              title="−20 palabras"
              aria-label="Retroceder 20 palabras"
            >
              ⏪
            </button>
            <button
              onClick={togglePlay}
              className={`${styles.playBtn} ${isPlaying ? styles.playing : ""}`}
              aria-label={isPlaying ? "Pausar" : "Reproducir"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => setCurrentIdx((p) => Math.min(words.length - 1, p + 20))}
              className={styles.ctrlBtn}
              title="+20 palabras"
              aria-label="Avanzar 20 palabras"
            >
              ⏩
            </button>
          </div>

          {/* Speed */}
          <div className={styles.speedGroup}>
            <span className={styles.speedLabel}>Velocidad</span>
            <button
              onClick={() => setSpeed(wpm - 25)}
              className={styles.speedAdjBtn}
              aria-label="Reducir velocidad"
            >
              −
            </button>
            <div className={styles.wpmInputWrap}>
              <input
                type="number"
                min={MIN_WPM}
                max={MAX_WPM}
                value={wpmInput}
                onChange={(e) => setWpmInput(e.target.value)}
                onBlur={(e) => setSpeed(Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter") setSpeed(Number(wpmInput)); }}
                className={styles.wpmInput}
                aria-label="Palabras por minuto"
              />
              <span className={styles.wpmUnit}>ppm</span>
            </div>
            <button
              onClick={() => setSpeed(wpm + 25)}
              className={styles.speedAdjBtn}
              aria-label="Aumentar velocidad"
            >
              +
            </button>
            <div className={styles.kbHint}>
              <span className={styles.kbKey}>↑↓</span>
            </div>
          </div>

          {/* Stats */}
          <div className={styles.statsGroup}>
            <div>{currentIdx + 1} / {words.length} palabras</div>
            <div>~<span className={styles.statsTime}>{minutesLeft} min</span> restantes</div>
          </div>
        </div>
      )}
    </div>
  );
}
