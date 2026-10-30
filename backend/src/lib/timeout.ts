export function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

export function isConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Request timed out') ||
    message.includes('fetch failed') ||
    message.includes('NetworkError') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND')
  );
}
