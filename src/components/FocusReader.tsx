"use client";

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  parsePdf, parseEpub, buildParagraphsFromText,
  type Paragraph,
} from "@/lib/parsers";
import { computeWordDurations } from "@/lib/wordTiming";
import { buildChunks, findChunkForWord, bionicSplit, type Chunk } from "@/lib/chunker";
import styles from "./FocusReader.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_WPM = 50;
const MAX_WPM = 800;
const FONT_SIZE_LABELS = ["S", "M", "L", "XL"];
const FONT_SIZE_VALUES = ["1rem", "1.125rem", "1.3rem", "1.6rem"];

// ─── Bionic word renderer (inline helper) ────────────────────────────────────
function BionicWord({ word, className }: { word: string; className?: string }) {
  const [bold, normal] = bionicSplit(word);
  return (
    <span className={className}>
      <strong className={styles.bionicBold}>{bold}</strong>{normal}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function FocusReader() {
  // ── Core state ────────────────────────────────────────────────────────────
  const [words, setWords]               = useState<string[]>([]);
  const [paragraphs, setParagraphs]     = useState<Paragraph[]>([]);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isPlaying, setIsPlaying]       = useState(false);
  const [wpm, setWpm]                   = useState(250);
  const [wpmInput, setWpmInput]         = useState("250");
  const [fontSizeIdx, setFontSizeIdx]   = useState(1);
  const [fileName, setFileName]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [loadingMsg, setLoadingMsg]     = useState("Procesando…");
  const [mode, setMode]                 = useState<"scroll" | "spritz">("scroll");
  const [progress, setProgress]         = useState(0);
  const [darkMode, setDarkMode]         = useState(true);
  const [showChapters, setShowChapters] = useState(false);
  // Humanized reading options
  const [chunkSize, setChunkSize]       = useState(2);   // words per display group
  const [bionicMode, setBionicMode]     = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const timerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordRefs           = useRef<(HTMLSpanElement | null)[]>([]);
  const containerRef       = useRef<HTMLDivElement>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const isPlayingRef       = useRef(isPlaying);
  const chunksLenRef       = useRef(0);
  const currentChunkIdxRef = useRef(0);
  const durationsRef       = useRef<number[]>([]);
  const chunkDurationsRef  = useRef<number[]>([]);

  // ── Derived: chunks ───────────────────────────────────────────────────────
  const chunks = useMemo(
    () => buildChunks(words, paragraphs, chunkSize),
    [words, paragraphs, chunkSize]
  );

  // ── Derived: current word range ───────────────────────────────────────────
  const currentChunk     = chunks[currentChunkIdx] ?? { startIdx: 0, endIdx: 0 };
  const currentWordStart = currentChunk.startIdx;
  const currentWordEnd   = currentChunk.endIdx;

  // ── Derived: current paragraph index ─────────────────────────────────────
  const currentParaIdx = useMemo(
    () => paragraphs.findIndex((p) => currentWordStart >= p.startIdx && currentWordStart <= p.endIdx),
    [currentWordStart, paragraphs]
  );

  // ── Derived: chapters (h1 + h2) ──────────────────────────────────────────
  const chapters = useMemo(
    () => paragraphs.map((p, idx) => ({ ...p, paraIdx: idx })).filter((p) => p.type === "h1" || p.type === "h2"),
    [paragraphs]
  );

  // ── Derived: current chapter label ────────────────────────────────────────
  const currentChapterLabel = useMemo(() => {
    for (let i = currentParaIdx; i >= 0; i--) {
      const p = paragraphs[i];
      if (p && (p.type === "h1" || p.type === "h2"))
        return words.slice(p.startIdx, p.endIdx + 1).join(" ");
    }
    return "";
  }, [currentParaIdx, paragraphs, words]);

  // ── Sync refs ─────────────────────────────────────────────────────────────
  useEffect(() => { isPlayingRef.current       = isPlaying;         }, [isPlaying]);
  useEffect(() => { chunksLenRef.current        = chunks.length;     }, [chunks.length]);
  useEffect(() => { currentChunkIdxRef.current  = currentChunkIdx;   }, [currentChunkIdx]);

  // ── Compute adaptive timings ──────────────────────────────────────────────
  useEffect(() => {
    const wordDurs = computeWordDurations(words, paragraphs, wpm);
    durationsRef.current = wordDurs;

    const baseMs = (60 / wpm) * 1000;
    chunkDurationsRef.current = chunks.map((chunk) => {
      let maxDur = baseMs;
      for (let i = chunk.startIdx; i <= chunk.endIdx; i++) {
        const d = wordDurs[i] ?? baseMs;
        if (d > maxDur) maxDur = d;
      }
      const count = chunk.endIdx - chunk.startIdx + 1;
      // Each additional simultaneous word adds ~35% to display time
      return maxDur * (count === 1 ? 1.0 : 1 + (count - 1) * 0.35);
    });
  }, [words, paragraphs, wpm, chunks]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "scroll") return;
    const el = wordRefs.current[currentWordStart];
    if (el && containerRef.current) {
      const c = containerRef.current;
      c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
    }
  }, [currentWordStart, mode]);

  // ── Progress ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (words.length > 1)
      setProgress(Math.round((currentWordEnd / (words.length - 1)) * 100));
  }, [currentWordEnd, words.length]);

  // ── Adaptive playback (variable timing, no side effects inside setState) ──
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled || !isPlayingRef.current) return;
      const idx   = currentChunkIdxRef.current;
      const delay = chunkDurationsRef.current[idx] ?? (60 / wpm) * 1000;

      timerRef.current = setTimeout(() => {
        if (cancelled || !isPlayingRef.current) return;
        const cur = currentChunkIdxRef.current;
        if (cur >= chunksLenRef.current - 1) {
          setIsPlaying(false);
          return;
        }
        setCurrentChunkIdx(cur + 1);
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

  // ── Speed helpers ─────────────────────────────────────────────────────────
  const setSpeed = useCallback((val: number) => {
    const v = Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(val)));
    setWpm(v);
    setWpmInput(String(v));
  }, []);

  // ── Jump to word ──────────────────────────────────────────────────────────
  const jumpToWord = useCallback((wordIdx: number) => {
    const clamped = Math.max(0, Math.min(words.length - 1, wordIdx));
    setCurrentChunkIdx(findChunkForWord(chunks, clamped));
  }, [words.length, chunks]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space")      { e.preventDefault(); setIsPlaying((p) => !p); }
      if (e.code === "ArrowUp")    { e.preventDefault(); setSpeed(wpm + 25); }
      if (e.code === "ArrowDown")  { e.preventDefault(); setSpeed(wpm - 25); }
      if (e.code === "ArrowRight") jumpToWord(currentWordEnd + 10);
      if (e.code === "ArrowLeft")  jumpToWord(currentWordStart - 10);
      if (e.code === "Escape")     setShowChapters(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [wpm, currentWordStart, currentWordEnd, jumpToWord, setSpeed]);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file) return;
    setLoading(true);
    setFileName(file.name);
    setIsPlaying(false);
    setWords([]);
    setParagraphs([]);
    setCurrentChunkIdx(0);
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
      setCurrentChunkIdx(0);
      setProgress(0);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error desconocido";
      const r = buildParagraphsFromText(`Error al leer el archivo: ${msg}`);
      setWords(r.words);
      setParagraphs(r.paragraphs);
    }
    setLoading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const togglePlay = () => {
    if (currentChunkIdx >= chunks.length - 1) setCurrentChunkIdx(0);
    setIsPlaying((p) => !p);
  };

  const minutesLeft = Math.ceil((words.length - currentWordEnd) / wpm);

  // ── Spritz render ─────────────────────────────────────────────────────────
  const renderSpritz = () => {
    const chunk  = chunks[currentChunkIdx];
    if (!chunk) return null;
    const chunkWords = words.slice(chunk.startIdx, chunk.endIdx + 1);
    const isHeading  = paragraphs[currentParaIdx]?.type !== "body";

    return (
      <div className={styles.spritzReader}>
        {currentChapterLabel && (
          <div className={styles.spritzChapter}>📖 {currentChapterLabel}</div>
        )}
        <div className={`${styles.spritzCard} ${isHeading ? styles.spritzHeadingCard : ""}`}>
          <div className={styles.spritzChunk}>
            {chunkWords.map((word, i) => (
              <span key={i} className={`${styles.spritzChunkWord} ${isHeading ? styles.spritzHeadingWord : ""}`}>
                {bionicMode
                  ? <BionicWord word={word} />
                  : word
                }
                {i < chunkWords.length - 1 ? "\u00a0" : ""}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.spritzMeta}>
          <span className={styles.spritzProgress}>{currentWordEnd + 1} / {words.length}</span>
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

        const isHeading  = para.type !== "body";
        const showBreak  = (para.type === "h1" || para.type === "h2") && pIdx > 0;
        const paraClass  = [
          styles.paragraph,
          styles[para.type],
          isCurrentPara ? (isHeading ? styles.activePara : styles.active) : "",
        ].filter(Boolean).join(" ");

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
                const absIdx   = para.startIdx + wOff;
                const isActive = absIdx >= currentWordStart && absIdx <= currentWordEnd;
                const isPast   = absIdx < currentWordStart;

                return (
                  <span
                    key={absIdx}
                    ref={(el) => { wordRefs.current[absIdx] = el; }}
                    onClick={() => {
                      const cIdx = findChunkForWord(chunks, absIdx);
                      setCurrentChunkIdx(cIdx);
                      setIsPlaying(true);
                    }}
                    className={[
                      styles.word,
                      isActive ? styles.current : "",
                      isPast   ? styles.past    : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {bionicMode && !isHeading
                      ? <BionicWord word={word} />
                      : word
                    }{" "}
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
        <button className={styles.chaptersPanelClose} onClick={() => setShowChapters(false)} aria-label="Cerrar">✕</button>
      </div>
      <div className={styles.chaptersList}>
        {chapters.map((ch, i) => {
          const label = words.slice(ch.startIdx, ch.endIdx + 1).join(" ");
          const isCurrent = ch.paraIdx === currentParaIdx ||
            (currentParaIdx > ch.paraIdx && (i === chapters.length - 1 || currentParaIdx < chapters[i + 1]?.paraIdx));
          return (
            <button
              key={i}
              className={[styles.chapterItem, ch.type === "h1" ? styles.h1type : "", isCurrent ? styles.currentChapterItem : ""].filter(Boolean).join(" ")}
              onClick={() => { jumpToWord(ch.startIdx); setShowChapters(false); setIsPlaying(false); }}
            >
              <span className={styles.chapterItemIcon}>{ch.type === "h1" ? "H1" : "H2"}</span>
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
          {fileName && <span className={styles.fileName} title={fileName}>{fileName}</span>}
        </div>

        <div className={styles.controls}>
          {/* Chapters */}
          {words.length > 0 && chapters.length > 0 && (
            <button onClick={() => setShowChapters((s) => !s)} className={`${styles.chaptersBtn} ${showChapters ? styles.open : ""}`}>
              ☰ {chapters.length} caps.
            </button>
          )}

          {/* Mode toggle */}
          <div className={styles.segmented}>
            {(["scroll", "spritz"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`${styles.segBtn} ${mode === m ? styles.active : styles.inactive}`} aria-pressed={mode === m}>
                {m === "scroll" ? "📜 Scroll" : "⚡ Spritz"}
              </button>
            ))}
          </div>

          {/* Chunk size */}
          <div className={styles.fontSizeBtns} title="Palabras por grupo" style={{ gap: 3 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => { setIsPlaying(false); setChunkSize(n); }}
                className={`${styles.fontSizeBtn} ${chunkSize === n ? styles.active : styles.inactive}`}
                title={`${n} ${n === 1 ? "palabra" : "palabras"} por grupo`}
                aria-pressed={chunkSize === n}
                style={{ width: 28 }}
              >
                ×{n}
              </button>
            ))}
          </div>

          {/* Bionic reading toggle */}
          <button
            onClick={() => setBionicMode((b) => !b)}
            className={`${styles.iconBtn} ${bionicMode ? styles.bionicActive : ""}`}
            title={bionicMode ? "Desactivar Bionic Reading" : "Activar Bionic Reading"}
            aria-pressed={bionicMode}
          >
            <span style={{ fontWeight: 800, fontStyle: "italic", fontSize: "0.85rem" }}>B</span>
          </button>

          {/* Font size (scroll only) */}
          {mode === "scroll" && (
            <div className={styles.fontSizeBtns}>
              {FONT_SIZE_LABELS.map((lbl, i) => (
                <button key={i} onClick={() => setFontSizeIdx(i)}
                  className={`${styles.fontSizeBtn} ${fontSizeIdx === i ? styles.active : styles.inactive}`}
                  aria-label={`Fuente ${lbl}`} aria-pressed={fontSizeIdx === i}>
                  {lbl}
                </button>
              ))}
            </div>
          )}

          {/* Dark mode */}
          <button onClick={() => setDarkMode((d) => !d)} className={styles.iconBtn} aria-label={darkMode ? "Modo claro" : "Modo oscuro"}>
            {darkMode ? "☀️" : "🌙"}
          </button>

          {/* Upload */}
          <button onClick={() => fileInputRef.current?.click()} className={styles.uploadBtn}>
            <span>+</span> Subir
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.epub,.txt" style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
        </div>
      </header>

      {/* ── Progress bar ── */}
      {words.length > 0 && (
        <div className={styles.progressBar} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* ── Main ── */}
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
            <p className={styles.emptyDesc}>FocusReader resalta cada palabra mientras avanzas,<br />manteniendo tu atención en la lectura.</p>
            <div className={styles.emptyFormats}>
              <span className={styles.badge}>PDF</span>
              <span className={styles.badge}>EPUB</span>
              <span className={styles.badge}>TXT</span>
            </div>
            <div className={styles.emptyDrop}><span>🖱️</span><span>Arrastra tu archivo aquí</span></div>
          </div>
        )}

        {!loading && words.length > 0 && (mode === "scroll" ? renderScroll() : renderSpritz())}
        {showChapters && renderChaptersPanel()}
      </main>

      {/* ── Controls bar ── */}
      {words.length > 0 && !loading && (
        <div className={styles.controlsBar}>
          <div className={styles.playbackGroup}>
            <button onClick={() => { setIsPlaying(false); setCurrentChunkIdx(0); }} className={styles.ctrlBtn} aria-label="Reiniciar">⏮</button>
            <button onClick={() => jumpToWord(currentWordStart - 20)} className={styles.ctrlBtn} aria-label="−20">⏪</button>
            <button onClick={togglePlay} className={`${styles.playBtn} ${isPlaying ? styles.playing : ""}`} aria-label={isPlaying ? "Pausar" : "Reproducir"}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button onClick={() => jumpToWord(currentWordEnd + 20)} className={styles.ctrlBtn} aria-label="+20">⏩</button>
          </div>

          <div className={styles.speedGroup}>
            <span className={styles.speedLabel}>Velocidad</span>
            <button onClick={() => setSpeed(wpm - 25)} className={styles.speedAdjBtn}>−</button>
            <div className={styles.wpmInputWrap}>
              <input type="number" min={MIN_WPM} max={MAX_WPM} value={wpmInput}
                onChange={(e) => setWpmInput(e.target.value)}
                onBlur={(e) => setSpeed(Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter") setSpeed(Number(wpmInput)); }}
                className={styles.wpmInput} aria-label="PPM" />
              <span className={styles.wpmUnit}>ppm</span>
            </div>
            <button onClick={() => setSpeed(wpm + 25)} className={styles.speedAdjBtn}>+</button>
            <div className={styles.kbHint}><span className={styles.kbKey}>↑↓</span></div>
          </div>

          <div className={styles.statsGroup}>
            <div>{currentWordEnd + 1} / {words.length} palabras</div>
            <div>~<span className={styles.statsTime}>{minutesLeft} min</span> restantes</div>
          </div>
        </div>
      )}
    </div>
  );
}
