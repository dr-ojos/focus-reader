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

// ---------- Helpers ----------

/** Strip HTML → clean plain text preserving paragraph breaks */
export const htmlToText = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,aside").forEach((n) => n.remove());
  doc.querySelectorAll("p,div,br,h1,h2,h3,h4,h5,h6,li").forEach((n) => {
    n.insertAdjacentText("afterend", "\n\n");
  });
  return ((doc.body as HTMLElement)?.innerText || doc.body?.textContent || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

// ---------- Parsers ----------

export async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map((item: any) => item.str).join(" ") + "\n\n";
  }
  return fullText.trim();
}

export async function parseEpub(arrayBuffer: ArrayBuffer): Promise<string> {
  await loadJSZip();
  const JSZip = (window as any).JSZip;
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Find OPF via META-INF/container.xml
  let opfPath = "";
  try {
    const containerXml: string = await zip.file("META-INF/container.xml").async("text");
    const match = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (match) opfPath = match[1];
  } catch {}

  // 2. Parse OPF → spine order
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

  // Fallback: all xhtml/html files sorted
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

  // 3. Extract text from each spine file
  const parts: string[] = [];
  for (const filePath of spineFiles) {
    const fileObj = zip.file(filePath) || zip.file(decodeURIComponent(filePath));
    if (!fileObj) continue;
    try {
      const html: string = await fileObj.async("text");
      const chunk = htmlToText(html);
      if (chunk.length > 20) parts.push(chunk);
    } catch {}
  }

  return parts.join("\n\n");
}

// ---------- Text → Paragraph model ----------

export interface Paragraph {
  startIdx: number;
  endIdx: number;
}

export function buildParagraphs(text: string): {
  words: string[];
  paragraphs: Paragraph[];
} {
  const rawParas = text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const allWords: string[] = [];
  const paraMap: Paragraph[] = [];

  if (rawParas.length > 1) {
    rawParas.forEach((para) => {
      const pWords = para.split(/\s+/).filter((w) => w.length > 0);
      if (!pWords.length) return;
      const start = allWords.length;
      allWords.push(...pWords);
      paraMap.push({ startIdx: start, endIdx: allWords.length - 1 });
    });
  } else {
    const flat = text.split(/\s+/).filter((w) => w.length > 0);
    allWords.push(...flat);
    const CHUNK = 10;
    for (let i = 0; i < flat.length; i += CHUNK) {
      paraMap.push({ startIdx: i, endIdx: Math.min(i + CHUNK - 1, flat.length - 1) });
    }
  }

  return { words: allWords, paragraphs: paraMap };
}
