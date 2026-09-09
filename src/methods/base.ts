import type { SearchResult, MethodConfig } from '../types/index.js';

/**
 * Base class for all search methods.
 * Each method wraps one concrete search capability (ripgrep, glob, AST, etc.)
 */
export abstract class BaseMethod {
  abstract readonly name: string;
  abstract readonly config: MethodConfig;

  abstract execute(params: Record<string, unknown>): Promise<SearchResult[]>;
}
