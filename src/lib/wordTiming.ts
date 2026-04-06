import type { Paragraph } from "./parsers";

/**
 * Calcula la duración en ms para mostrar cada palabra.
 *
 * Factores (basados en investigación de eye-tracking y RSVP adaptativo):
 *  1. Longitud de la palabra        → más letras = más tiempo
 *  2. Puntuación al final           → coma = pausa corta, punto = pausa larga
 *  3. Inicio de nuevo párrafo       → pausa de "respiración"
 *  4. Primera palabra tras punto    → pausa extra (nueva oración)
 *  5. Palabras muy cortas (artículos, preposiciones) → pasan más rápido
 */
export function computeWordDurations(
  words: string[],
  paragraphs: Paragraph[],
  baseWpm: number
): number[] {
  const baseMs = (60 / baseWpm) * 1000;

  // Índices donde empieza un nuevo párrafo
  const paraStartSet = new Set(paragraphs.map((p) => p.startIdx));

  const durations: number[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // ── 1. Factor de longitud ─────────────────────────────────────────────
    // Solo contamos letras (sin puntuación añadida)
    const letters = word.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g, "").length || 1;
    let lengthFactor: number;
    if (letters <= 2)       lengthFactor = 0.72;   // "a", "el", "de"
    else if (letters <= 4)  lengthFactor = 0.88;   // "casa", "que"
    else if (letters <= 6)  lengthFactor = 1.0;    // palabra media
    else if (letters <= 9)  lengthFactor = 1.18;   // "comprende"
    else if (letters <= 12) lengthFactor = 1.35;   // "comprensión"
    else                    lengthFactor = 1.5;    // palabras muy largas

    let ms = baseMs * lengthFactor;

    // ── 2. Inicio de párrafo (pausa de respiración antes de leer) ────────
    if (paraStartSet.has(i) && i > 0) {
      ms *= 2.2;
    }

    // ── 3. Pausa por puntuación —aplicada a la palabra ANTERIOR ──────────
    //       (se agrega al tiempo de DISPLAY de la palabra actual, que es
    //        la que el lector ve después de la puntuación)
    if (i > 0) {
      const prevWord = words[i - 1];
      const lastChar = prevWord[prevWord.length - 1] || "";

      if ([".", "!", "?", "…", "»", '"'].includes(lastChar)) {
        // Fin de oración: pausa importante
        ms *= 1.6;
      } else if ([",", ";", ":", "—", "–"].includes(lastChar)) {
        // Pausa media (coma, punto y coma)
        ms *= 1.25;
      }
    }

    // ── 4. La propia palabra termina en puntuación (el lector necesita
    //        tiempo para procesarla antes de pasar a la siguiente) ─────────
    const thisLastChar = word[word.length - 1] || "";
    if ([".", "!", "?", "…"].includes(thisLastChar)) {
      ms *= 1.25;
    } else if ([",", ";", ":"].includes(thisLastChar)) {
      ms *= 1.1;
    }

    // ── 5. Números y siglas (e.g. "COVID-19", "II") son más difíciles ─────
    if (/\d/.test(word) || /^[A-ZÁÉÍÓÚ]{2,}$/.test(word)) {
      ms *= 1.2;
    }

    // Límites: nunca menos de 80 ms ni más de 2800 ms
    durations.push(Math.min(Math.max(ms, 80), 2800));
  }

  return durations;
}
