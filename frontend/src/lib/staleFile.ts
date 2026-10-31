// Browsers word a missing page file differently; all of these mean the app was updated under an open tab.
const STALE_FILE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|not a valid JavaScript MIME type|Unable to preload CSS/i;

export function isStaleFileError(error: unknown): boolean {
  return error instanceof Error && STALE_FILE.test(error.message);
}
