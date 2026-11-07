// Browser-only: read an uploaded file for the listings import.
// Spreadsheets become a grid of cells; documents become plain text.
// Libraries are loaded only when a file of that kind is chosen.
import { parseCsv } from "./listings";
import type { Cell } from "./listings-import";

export type ReadResult =
  | { kind: "table"; grid: Cell[][]; sheet: string | null; otherSheets: string[] }
  | { kind: "text"; text: string; pages?: number };

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

export const ACCEPTED = ".csv,.tsv,.txt,.xlsx,.xlsm,.pdf,.docx,.md";

export async function readFileForImport(file: File): Promise<ReadResult> {
  const e = ext(file.name);
  if (["csv", "tsv"].includes(e)) {
    const text = await file.text();
    return { kind: "table", grid: e === "tsv" ? text.split(/\r?\n/).map((l) => l.split("\t")) : parseCsv(text), sheet: null, otherSheets: [] };
  }
  if (["xlsx", "xlsm"].includes(e)) return readExcel(file);
  if (e === "pdf") return readPdf(file);
  if (e === "docx") return readDocx(file);
  if (["txt", "md"].includes(e)) return { kind: "text", text: await file.text() };
  if (e === "xls") throw new Error("This is an old Excel file (.xls). Open it in Excel and save it as .xlsx, then upload that.");
  if (["doc", "odt", "rtf", "pages"].includes(e)) throw new Error("Save this document as PDF or .docx and upload that.");
  if (["ods", "numbers"].includes(e)) throw new Error("Save this spreadsheet as .xlsx or .csv and upload that.");
  if (["jpg", "jpeg", "png", "heic", "webp"].includes(e)) throw new Error("Photos of listings can't be read yet. Upload the PDF, Word or Excel file they came from.");
  throw new Error("Elliot can read Excel (.xlsx), CSV, PDF, Word (.docx) and text files.");
}

async function readExcel(file: File): Promise<ReadResult> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  // The sheet with the most filled rows is almost always the listings.
  const score = (data: Cell[][]) => data.filter((r) => r.filter((c) => c != null && c !== "").length >= 2).length;
  const sorted = [...sheets].sort((a, b) => score(b.data as Cell[][]) - score(a.data as Cell[][]));
  const main = sorted[0];
  if (!main || score(main.data as Cell[][]) === 0) throw new Error("This spreadsheet looks empty.");
  return {
    kind: "table",
    grid: main.data as Cell[][],
    sheet: main.sheet,
    otherSheets: sorted.slice(1).filter((s) => score(s.data as Cell[][]) > 0).map((s) => s.sheet),
  };
}

async function readPdf(file: File): Promise<ReadResult> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    // Keep line breaks: listings are usually laid out line by line.
    let text = "";
    for (const item of content.items as any[]) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
  }
  const text = pages.join("\n\n").trim();
  if (!text) throw new Error("This PDF has no text in it. It's probably a scan, which can't be read yet. Upload the original document or a spreadsheet instead.");
  return { kind: "text", text, pages: pdf.numPages };
}

async function readDocx(file: File): Promise<ReadResult> {
  // mammoth's package.json maps its file access to browser versions for webpack.
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  if (!String(value || "").trim()) throw new Error("This document has no text in it.");
  return { kind: "text", text: String(value) };
}
