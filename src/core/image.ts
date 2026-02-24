/**
 * Image Support — base64 encoding and media type detection.
 *
 * Enables sending images to multimodal LLMs as content blocks.
 */

import { readFile } from "fs/promises";
import { extname } from "path";

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

const IMAGE_EXTENSIONS = new Set(Object.keys(MEDIA_TYPES));

/**
 * Check if a file path is a supported image.
 */
export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Get the media type for an image file.
 */
export function getMediaType(filePath: string): string {
  return MEDIA_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Load an image file and return it as a base64-encoded content block
 * suitable for the Anthropic API.
 */
export async function loadImageAsBlock(
  filePath: string
): Promise<{
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}> {
  const data = await readFile(filePath);
  const base64 = data.toString("base64");
  const mediaType = getMediaType(filePath);

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data: base64,
    },
  };
}

/**
 * Build content blocks with images from user input.
 * If images are detected, returns an array of text + image blocks.
 * Otherwise returns the input string as-is.
 */
export async function buildContentWithImages(
  userInput: string
): Promise<string | Array<{ type: string; [key: string]: unknown }>> {
  const imagePaths = detectImagePaths(userInput);
  if (imagePaths.length === 0) return userInput;

  const contentBlocks: Array<{ type: string; [key: string]: unknown }> = [
    { type: "text", text: userInput },
  ];
  for (const imgPath of imagePaths) {
    try {
      const imageBlock = await loadImageAsBlock(imgPath);
      contentBlocks.push(imageBlock as { type: string; [key: string]: unknown });
    } catch {}
  }
  return contentBlocks.length > 1 ? contentBlocks : userInput;
}

/**
 * Detect image paths in user input text.
 * Returns array of image paths found.
 */
export function detectImagePaths(input: string): string[] {
  const paths: string[] = [];
  // Match absolute paths or relative paths that look like image files
  const pathRegex = /(?:^|\s)((?:\/[\w.-]+)+\.\w+|\.\/[\w./-]+\.\w+)/g;
  let match;
  while ((match = pathRegex.exec(input)) !== null) {
    const path = match[1];
    if (isImagePath(path)) {
      paths.push(path);
    }
  }
  return paths;
}
