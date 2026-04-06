// ---------- Loaders ----------

const loadScript = (src: string, check: () => boolean): Promise<void> =>
  new Promise((resolve) => {
    if (check()) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });

export const loadPdfJs = (): Promise<any> =>
  new Promise((resolve) => {
    if ((window as any).pdfjsLib) return resolve((window as any).pdfjsLib);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(lib);
    };
    document.head.appendChild(script);
  });

export const loadJSZip = (): Promise<void> =>
  loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    () => !!(window as any).JSZip
  );

// ---------- Types ----------

export type BlockType = "h1" | "h2" | "h3" | "h4" | "body";

export interface Block {
  text: string;
  type: BlockType;
}

export interface Paragraph {
  startIdx: number;
  endIdx: number;
  type: BlockType;
}

// ---------- HTML → Blocks (preserves heading hierarchy) ----------

export const htmlToBlocks = (html: string): Block[] => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,aside").forEach((n) => n.remove());

  const typeMap: Record<string, BlockType> = {
    h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h4", h6: "h4",
  };

  const blocks: Block[] = [];
  const seen = new WeakSet<Element>();

  const collect = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;

    if (typeMap[tag]) {
      const text = (el.textContent || "").trim();
      if (text.length > 0) blocks.push({ text, type: typeMap[tag] });
    } else if (tag === "p" || tag === "li") {
      if (!el.querySelector("h1,h2,h3,h4,h5,h6")) {
        const text = (el.textContent || "").trim();
        if (text.length > 0) {
          blocks.push({ text, type: "body" });
          el.querySelectorAll("*").forEach((c) => seen.add(c));
        }
      } else {
        Array.from(el.children).forEach(collect);
      }
    } else {
      Array.from(el.children).forEach(collect);
    }
  };

  Array.from(doc.body?.children || []).forEach(collect);
  return blocks;
};

// ---------- Parsers ----------

export async function parsePdf(
  arrayBuffer: ArrayBuffer
): Promise<{ words: string[]; paragraphs: Paragraph[] }> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  interface RawItem { str: string; fontSize: number; y: number; }
  const allItems: RawItem[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pageH: number = viewport.height;

    content.items.forEach((item: any) => {
      const str = (item.str || "").trim();
      if (!str) return;
      const t = item.transform;
      const fontSize = Math.abs(t[3]) || Math.abs(t[0]) || 12;
      const y = (pageH - t[5]) + (pageNum - 1) * (pageH + 100);
      allItems.push({ str, fontSize, y });
    });
  }

  if (!allItems.length) return { words: [], paragraphs: [] };
  allItems.sort((a, b) => a.y - b.y);

  // Group into visual lines by y proximity
  const lines: Array<{ text: string; fontSize: number; y: number }> = [];
  let lineItems: RawItem[] = [allItems[0]];

  for (let i = 1; i < allItems.length; i++) {
    if (Math.abs(allItems[i].y - lineItems[0].y) <= 4) {
      lineItems.push(allItems[i]);
    } else {
      const text = lineItems.map((x) => x.str).join(" ").trim();
      const avgSize = lineItems.reduce((s, x) => s + x.fontSize, 0) / lineItems.length;
      if (text) lines.push({ text, fontSize: avgSize, y: lineItems[0].y });
      lineItems = [allItems[i]];
    }
  }
  {
    const text = lineItems.map((x) => x.str).join(" ").trim();
    const avgSize = lineItems.reduce((s, x) => s + x.fontSize, 0) / lineItems.length;
    if (text) lines.push({ text, fontSize: avgSize, y: lineItems[0].y });
  }

  // Median font size → heading thresholds
  const sortedSizes = [...lines.map((l) => l.fontSize)].sort((a, b) => a - b);
  const median = sortedSizes[Math.floor(sortedSizes.length / 2)] || 12;

  const gaps = lines
    .slice(1)
    .map((l, i) => l.y - lines[i].y)
    .filter((g) => g > 0 && g < 100);
  const avgGap = gaps.length
    ? gaps.reduce((s, g) => s + g, 0) / gaps.length
    : 20;

  // Build blocks
  const blocks: Block[] = [];
  let bodyLines: string[] = [];

  const flushBody = () => {
    if (bodyLines.length) {
      blocks.push({ text: bodyLines.join(" "), type: "body" });
      bodyLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const { text, fontSize, y } = lines[i];
    const gap = i > 0 ? y - lines[i - 1].y : 0;
    const isParaBreak = i > 0 && gap > avgGap * 1.6;

    let type: BlockType = "body";
    if (fontSize >= median * 1.7) type = "h1";
    else if (fontSize >= median * 1.35) type = "h2";
    else if (fontSize >= median * 1.15) type = "h3";

    if (type !== "body") {
      flushBody();
      blocks.push({ text, type });
    } else {
      if (isParaBreak) flushBody();
      bodyLines.push(text);
    }
  }
  flushBody();

  return buildParagraphsFromBlocks(blocks);
}

export async function parseEpub(
  arrayBuffer: ArrayBuffer
): Promise<{ words: string[]; paragraphs: Paragraph[] }> {
  await loadJSZip();
  const JSZip = (window as any).JSZip;
  const zip = await JSZip.loadAsync(arrayBuffer);

  let opfPath = "";
  try {
    const containerXml: string = await zip.file("META-INF/container.xml").async("text");
    const match = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (match) opfPath = match[1];
  } catch {}

  let spineFiles: string[] = [];
  if (opfPath) {
    try {
      const opfXml: string = await zip.file(opfPath).async("text");
      const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
      const opfBase = opfPath.includes("/")
        ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
        : "";
      const manifest: Record<string, string> = {};
      opfDoc.querySelectorAll("manifest item").forEach((item) => {
        const id = item.getAttribute("id");
        const href = item.getAttribute("href");
        if (id && href) manifest[id] = href;
      });
      opfDoc.querySelectorAll("spine itemref").forEach((ref) => {
        const idref = ref.getAttribute("idref");
        if (idref && manifest[idref]) spineFiles.push(opfBase + manifest[idref]);
      });
    } catch {}
  }

  if (spineFiles.length === 0) {
    spineFiles = Object.keys(zip.files)
      .filter(
        (f: string) =>
          /\.(xhtml|html|htm)$/i.test(f) &&
          !f.toLowerCase().includes("toc") &&
          !f.toLowerCase().includes("ncx")
      )
      .sort();
  }

  const allBlocks: Block[] = [];
  for (const filePath of spineFiles) {
    const fileObj = zip.file(filePath) || zip.file(decodeURIComponent(filePath));
    if (!fileObj) continue;
    try {
      const html: string = await fileObj.async("text");
      const blocks = htmlToBlocks(html);
      if (blocks.length > 0) allBlocks.push(...blocks);
    } catch {}
  }

  if (allBlocks.length === 0) return { words: [], paragraphs: [] };
  return buildParagraphsFromBlocks(allBlocks);
}

// ---------- TXT → structured blocks ----------

export function buildParagraphsFromText(text: string): {
  words: string[];
  paragraphs: Paragraph[];
} {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let bodyBuffer: string[] = [];

  const flushBody = () => {
    const t = bodyBuffer.join(" ").trim();
    if (t.length > 0) blocks.push({ text: t, type: "body" });
    bodyBuffer = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("### ")) { flushBody(); blocks.push({ text: t.slice(4), type: "h3" }); }
    else if (t.startsWith("## ")) { flushBody(); blocks.push({ text: t.slice(3), type: "h2" }); }
    else if (t.startsWith("# "))  { flushBody(); blocks.push({ text: t.slice(2), type: "h1" }); }
    else if (t === "")            { flushBody(); }
    else                          { bodyBuffer.push(t); }
  }
  flushBody();

  return buildParagraphsFromBlocks(blocks);
}

// ---------- Core builder ----------

export function buildParagraphsFromBlocks(blocks: Block[]): {
  words: string[];
  paragraphs: Paragraph[];
} {
  const allWords: string[] = [];
  const paraMap: Paragraph[] = [];
  for (const block of blocks) {
    const bWords = block.text.split(/\s+/).filter((w) => w.length > 0);
    if (!bWords.length) continue;
    const start = allWords.length;
    allWords.push(...bWords);
    paraMap.push({ startIdx: start, endIdx: allWords.length - 1, type: block.type });
  }
  return { words: allWords, paragraphs: paraMap };
}

// Backward-compat alias used for error messages
export function buildParagraphs(text: string) {
  return buildParagraphsFromText(text);
}
