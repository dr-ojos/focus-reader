"use client";

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  parsePdf, parseEpub, buildParagraphsFromText, buildParagraphsFromBlocks,
  type Paragraph,
} from "@/lib/parsers";
import { computeWordDurations } from "@/lib/wordTiming";
import styles from "./FocusReader.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_WPM = 50;
const MAX_WPM = 800;
const FONT_SIZE_LABELS = ["S", "M", "L", "XL"];
const FONT_SIZE_VALUES = ["1rem", "1.125rem", "1.3rem", "1.6rem"];

// ─── Component ────────────────────────────────────────────────────────────────
export default function FocusReader() {
  const [words, setWords]             = useState<string[]>([]);
  const [paragraphs, setParagraphs]   = useState<Paragraph[]>([]);
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [wpm, setWpm]                 = useState(250);
  const [wpmInput, setWpmInput]       = useState("250");
  const [fontSizeIdx, setFontSizeIdx] = useState(1);
  const [fileName, setFileName]       = useState("");
  const [loading, setLoading]         = useState(false);
  const [loadingMsg, setLoadingMsg]   = useState("Procesando…");
  const [mode, setMode]               = useState<"scroll" | "spritz">("scroll");
  const [progress, setProgress]       = useState(0);
  const [darkMode, setDarkMode]       = useState(true);
  const [showChapters, setShowChapters] = useState(false);

  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordRefs      = useRef<(HTMLSpanElement | null)[]>([]);
  const containerRef  = useRef<HTMLDivElement>(null);
  // Always-fresh refs — safe to read inside setTimeout without stale closures
  const isPlayingRef  = useRef(isPlaying);
  const wordsLenRef   = useRef(words.length);
  const currentIdxRef = useRef(0);
  const durationsRef  = useRef<number[]>([]);
  const fileInputRef  = useRef<HTMLInputElement>(null);

  // Keep refs in sync with state
  useEffect(() => { isPlayingRef.current  = isPlaying;    }, [isPlaying]);
  useEffect(() => { wordsLenRef.current   = words.length; }, [words.length]);
  useEffect(() => { currentIdxRef.current = currentIdx;  }, [currentIdx]);

  // Recompute adaptive durations whenever words, paragraphs or WPM change
  useEffect(() => {
    durationsRef.current = computeWordDurations(words, paragraphs, wpm);
  }, [words, paragraphs, wpm]);

  // ── Derived: current paragraph index ─────────────────────────────────────
  const currentParaIdx = useMemo(
    () => paragraphs.findIndex((p) => currentIdx >= p.startIdx && currentIdx <= p.endIdx),
    [currentIdx, paragraphs]
  );

  // ── Derived: chapters list (h1 + h2) ─────────────────────────────────────
  const chapters = useMemo(
    () =>
      paragraphs
        .map((p, idx) => ({ ...p, paraIdx: idx }))
        .filter((p) => p.type === "h1" || p.type === "h2"),
    [paragraphs]
  );

  // ── Derived: current chapter label ────────────────────────────────────────
  const currentChapterLabel = useMemo(() => {
    for (let i = currentParaIdx; i >= 0; i--) {
      const p = paragraphs[i];
      if (p && (p.type === "h1" || p.type === "h2")) {
        return words.slice(p.startIdx, p.endIdx + 1).join(" ");
      }
    }
    return "";
  }, [currentParaIdx, paragraphs, words]);

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

  // ── Adaptive playback engine ─────────────────────────────────────────────
  // IMPORTANT: scheduleNext must NEVER be called inside a setState updater,
  // because React Strict Mode invokes updaters twice, causing exponential timeouts.
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    // `cancelled` flag ensures the old chain stops even if a timeout
    // fires between effect teardown and the next Strict Mode re-mount.
    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled || !isPlayingRef.current) return;

      const idx   = currentIdxRef.current;
      const delay = durationsRef.current[idx] ?? (60 / wpm) * 1000;

      timerRef.current = setTimeout(() => {
        if (cancelled || !isPlayingRef.current) return;

        const cur = currentIdxRef.current;
        if (cur >= wordsLenRef.current - 1) {
          setIsPlaying(false);
          return;
        }

        // Advance word (pure state update — no side effects inside)
        setCurrentIdx(cur + 1);
        // Schedule next OUTSIDE of setState
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // ── Speed ─────────────────────────────────────────────────────────────────
  const setSpeed = useCallback((val: number) => {
    const v = Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(val)));
    setWpm(v);
    setWpmInput(String(v));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space")       { e.preventDefault(); setIsPlaying((p) => !p); }
      if (e.code === "ArrowUp")     { e.preventDefault(); setSpeed(wpm + 25); }
      if (e.code === "ArrowDown")   { e.preventDefault(); setSpeed(wpm - 25); }
      if (e.code === "ArrowRight")  setCurrentIdx((p) => Math.min(words.length - 1, p + 10));
      if (e.code === "ArrowLeft")   setCurrentIdx((p) => Math.max(0, p - 10));
      if (e.code === "Escape")      setShowChapters(false);
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
    setShowChapters(false);
    wordRefs.current = [];

    try {
      let result: { words: string[]; paragraphs: Paragraph[] };

      if (file.name.endsWith(".pdf")) {
        setLoadingMsg("Extrayendo texto del PDF…");
        result = await parsePdf(await file.arrayBuffer());
      } else if (file.name.endsWith(".epub")) {
        setLoadingMsg("Descomprimiendo EPUB…");
        result = await parseEpub(await file.arrayBuffer());
        if (result.words.length < 10) throw new Error("No se pudo extraer texto del EPUB.");
      } else {
        setLoadingMsg("Leyendo archivo…");
        result = buildParagraphsFromText((await file.text()).trim());
      }

      setWords(result.words);
      setParagraphs(result.paragraphs);
      setCurrentIdx(0);
      setProgress(0);
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : "Error desconocido";
      const result = buildParagraphsFromText(`Error al leer el archivo: ${errMsg}`);
      setWords(result.words);
      setParagraphs(result.paragraphs);
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

  const togglePlay = () => {
    if (currentIdx >= words.length - 1) setCurrentIdx(0);
    setIsPlaying((p) => !p);
  };

  const minutesLeft = Math.ceil((words.length - currentIdx) / wpm);

  // ── Spritz render ─────────────────────────────────────────────────────────
  const renderSpritz = () => {
    const word = words[currentIdx] || "";
    const orp  = Math.max(1, Math.floor(word.length * 0.35));
    return (
      <div className={styles.spritzReader}>
        {currentChapterLabel && (
          <div className={styles.spritzChapter}>📖 {currentChapterLabel}</div>
        )}
        <div className={styles.spritzCard}>
          <div className={styles.spritzWord}>
            <span className={styles.spritzBefore}>{word.slice(0, orp)}</span>
            <span className={styles.spritzOrp}>{word[orp] || ""}</span>
            <span className={styles.spritzAfter}>{word.slice(orp + 1)}</span>
          </div>
        </div>
        <div className={styles.spritzMeta}>
          <span className={styles.spritzProgress}>{currentIdx + 1} / {words.length}</span>
          <span>·</span>
          <span>{wpm} ppm</span>
          <span>·</span>
          <span className={styles.statsTime}>{minutesLeft} min</span>
        </div>
      </div>
    );
  };

  // ── Scroll render ─────────────────────────────────────────────────────────
  const renderScroll = () => (
    <div ref={containerRef} className={styles.scrollReader}>
      {paragraphs.map((para, pIdx) => {
        const isCurrentPara = pIdx === currentParaIdx;
        const paraWords = words.slice(para.startIdx, para.endIdx + 1);
        if (!paraWords.length) return null;

        const isHeading = para.type !== "body";
        const showBreak = (para.type === "h1" || para.type === "h2") && pIdx > 0;

        const paraClass = [
          styles.paragraph,
          styles[para.type],
          isCurrentPara ? (isHeading ? styles.activePara : styles.active) : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <Fragment key={pIdx}>
            {showBreak && (
              <div className={styles.chapterBreak}>
                <span className={styles.chapterBreakLine} />
                <span className={styles.chapterBreakDot} />
                <span className={styles.chapterBreakLine} />
              </div>
            )}
            <p
              className={paraClass}
              style={isHeading ? undefined : { fontSize: FONT_SIZE_VALUES[fontSizeIdx] }}
            >
              {paraWords.map((word, wOff) => {
                const absIdx = para.startIdx + wOff;
                const isCurrent = absIdx === currentIdx;
                const isPast    = absIdx < currentIdx;
                return (
                  <span
                    key={absIdx}
                    ref={(el) => { wordRefs.current[absIdx] = el; }}
                    onClick={() => { setCurrentIdx(absIdx); setIsPlaying(true); }}
                    className={[
                      styles.word,
                      isCurrent ? styles.current : "",
                      isPast    ? styles.past    : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {word}{" "}
                  </span>
                );
              })}
            </p>
          </Fragment>
        );
      })}
    </div>
  );

  // ── Chapters panel ────────────────────────────────────────────────────────
  const renderChaptersPanel = () => (
    <div className={styles.chaptersPanel}>
      <div className={styles.chaptersPanelHeader}>
        <span>Capítulos</span>
        <button
          className={styles.chaptersPanelClose}
          onClick={() => setShowChapters(false)}
          aria-label="Cerrar panel de capítulos"
        >
          ✕
        </button>
      </div>
      <div className={styles.chaptersList}>
        {chapters.map((ch, i) => {
          const label = words.slice(ch.startIdx, ch.endIdx + 1).join(" ");
          const isCurrent = ch.paraIdx === currentParaIdx ||
            (currentParaIdx > ch.paraIdx &&
              (i === chapters.length - 1 || currentParaIdx < chapters[i + 1]?.paraIdx));
          return (
            <button
              key={i}
              className={[
                styles.chapterItem,
                ch.type === "h1" ? styles.h1type : "",
                isCurrent ? styles.currentChapterItem : "",
              ].filter(Boolean).join(" ")}
              onClick={() => {
                setCurrentIdx(ch.startIdx);
                setShowChapters(false);
                setIsPlaying(false);
              }}
            >
              <span className={styles.chapterItemIcon}>
                {ch.type === "h1" ? "H1" : "H2"}
              </span>
              <span className={styles.chapterItemText}>{label}</span>
            </button>
          );
        })}
        {chapters.length === 0 && (
          <p style={{ padding: "16px", fontSize: "0.8rem", color: "var(--muted)" }}>
            No se detectaron capítulos en este documento.
          </p>
        )}
      </div>
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
          {/* Chapters button */}
          {words.length > 0 && chapters.length > 0 && (
            <button
              onClick={() => setShowChapters((s) => !s)}
              className={`${styles.chaptersBtn} ${showChapters ? styles.open : ""}`}
              aria-label="Ver capítulos"
            >
              ☰ {chapters.length} caps.
            </button>
          )}

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
            aria-label={darkMode ? "Modo claro" : "Modo oscuro"}
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
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span className={styles.loadingText}>{loadingMsg}</span>
          </div>
        )}

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

        {!loading && words.length > 0 && (
          mode === "scroll" ? renderScroll() : renderSpritz()
        )}

        {/* Chapters panel overlay */}
        {showChapters && renderChaptersPanel()}
      </main>

      {/* ── Controls bar ── */}
      {words.length > 0 && !loading && (
        <div className={styles.controlsBar}>
          <div className={styles.playbackGroup}>
            <button onClick={() => { setIsPlaying(false); setCurrentIdx(0); }} className={styles.ctrlBtn} aria-label="Reiniciar">⏮</button>
            <button onClick={() => setCurrentIdx((p) => Math.max(0, p - 20))} className={styles.ctrlBtn} aria-label="−20 palabras">⏪</button>
            <button onClick={togglePlay} className={`${styles.playBtn} ${isPlaying ? styles.playing : ""}`} aria-label={isPlaying ? "Pausar" : "Reproducir"}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button onClick={() => setCurrentIdx((p) => Math.min(words.length - 1, p + 20))} className={styles.ctrlBtn} aria-label="+20 palabras">⏩</button>
          </div>

          <div className={styles.speedGroup}>
            <span className={styles.speedLabel}>Velocidad</span>
            <button onClick={() => setSpeed(wpm - 25)} className={styles.speedAdjBtn} aria-label="Reducir">−</button>
            <div className={styles.wpmInputWrap}>
              <input
                type="number" min={MIN_WPM} max={MAX_WPM}
                value={wpmInput}
                onChange={(e) => setWpmInput(e.target.value)}
                onBlur={(e) => setSpeed(Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter") setSpeed(Number(wpmInput)); }}
                className={styles.wpmInput}
                aria-label="Palabras por minuto"
              />
              <span className={styles.wpmUnit}>ppm</span>
            </div>
            <button onClick={() => setSpeed(wpm + 25)} className={styles.speedAdjBtn} aria-label="Aumentar">+</button>
            <div className={styles.kbHint}><span className={styles.kbKey}>↑↓</span></div>
          </div>

          <div className={styles.statsGroup}>
            <div>{currentIdx + 1} / {words.length} palabras</div>
            <div>~<span className={styles.statsTime}>{minutesLeft} min</span> restantes</div>
          </div>
        </div>
      )}
    </div>
  );
}
