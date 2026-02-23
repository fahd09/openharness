/**
 * PDF Support — text extraction from PDF files.
 *
 * Uses `pdftotext` CLI tool (from poppler-utils) for extraction.
 * Falls back to a simple binary-to-text extraction if pdftotext is unavailable.
 */

import { execFile } from "child_process";
import { readFile } from "fs/promises";

/**
 * Check if pdftotext is available.
 */
async function hasPdfToText(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", ["pdftotext"], (error) => resolve(!error));
  });
}

/**
 * Extract text from a PDF file using pdftotext.
 *
 * @param filePath - Path to the PDF file.
 * @param pages - Optional page range (e.g., "1-5", "3").
 * @returns Extracted text content.
 */
export async function extractPdfText(
  filePath: string,
  pages?: string
): Promise<string> {
  const usePdfToText = await hasPdfToText();

  if (usePdfToText) {
    return extractWithPdfToText(filePath, pages);
  }

  // Fallback: basic text extraction from PDF binary
  return extractBasic(filePath);
}

async function extractWithPdfToText(
  filePath: string,
  pages?: string
): Promise<string> {
  const args: string[] = [];

  if (pages) {
    // Parse page range
    const parts = pages.split("-");
    if (parts.length === 2) {
      args.push("-f", parts[0], "-l", parts[1]);
    } else if (parts.length === 1) {
      args.push("-f", parts[0], "-l", parts[0]);
    }
  }

  args.push("-layout", filePath, "-");

  return new Promise((resolve, reject) => {
    execFile("pdftotext", args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error(`pdftotext failed: ${error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Basic fallback: extract readable strings from PDF binary.
 * This is very rudimentary — only for when pdftotext is not available.
 */
async function extractBasic(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const text = buffer.toString("latin1");

  // Extract text between BT/ET operators (very basic PDF text extraction)
  const textChunks: string[] = [];
  const btRegex = /BT[\s\S]*?ET/g;
  let match;

  while ((match = btRegex.exec(text)) !== null) {
    const block = match[0];
    // Extract parenthesized strings (PDF text objects)
    const strRegex = /\(([^)]*)\)/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const decoded = strMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\([()])/g, "$1");
      if (decoded.trim()) {
        textChunks.push(decoded);
      }
    }
  }

  if (textChunks.length === 0) {
    return "(PDF text extraction failed — install pdftotext for better results: brew install poppler)";
  }

  return textChunks.join(" ");
}

/**
 * Check if a file is a PDF.
 */
export function isPdfPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".pdf");
}
