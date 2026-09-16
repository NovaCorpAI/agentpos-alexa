/** Typed errors: every failure the Bridge emits carries a machine-readable code. */
export interface BridgeErrorBody {
  code: string;
  message: string;
  hint: string;
}

export class BridgeError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly status: number;
  constructor(status: number, body: BridgeErrorBody) {
    super(body.message);
    this.name = "BridgeError";
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
  }
  toJSON(): BridgeErrorBody {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

export function storeNotFound(slug: string): BridgeError {
  return new BridgeError(404, {
    code: "STORE_NOT_FOUND",
    message: `No Store is registered under the slug ${JSON.stringify(slug)}`,
    hint: "Register the Store first, or check the slug in the URL.",
  });
}
