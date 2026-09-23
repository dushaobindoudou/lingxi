/** One row of the MCP tool table in the management window. See catalogue.mjs for why it exists. */
export interface CatalogueEntry {
  /** The tool name an agent calls, identical to the one in tools.mjs. */
  name: string;
  /** One short Chinese line for a human scanning the table. */
  purpose: string;
  /** What the tool can do to the user: 低 = cosmetic or read-only, 中 = screen or memory. */
  risk: '低' | '中' | '高';
}

export declare const catalogue: CatalogueEntry[];
