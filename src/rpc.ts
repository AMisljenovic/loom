import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

type Id = number | string;
type Handler = (params: any) => Promise<any> | any;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

/**
 * Minimal JSON-RPC 2.0 with LSP-style `Content-Length` framing.
 * Sufficient for our extension <-> Go agent bridge.
 */
export class JsonRpc extends EventEmitter {
  private nextId = 1;
  private pending = new Map<Id, Pending>();
  private handlers = new Map<string, Handler>();
  private buffer = Buffer.alloc(0);

  constructor(private readonly inp: Readable, private readonly out: Writable) {
    super();
    inp.on("data", (chunk: Buffer) => this.onData(chunk));
  }

  onRequest(method: string, handler: Handler) {
    this.handlers.set(method, handler);
  }

  notify(method: string, params?: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private send(obj: unknown) {
    const json = JSON.stringify(obj);
    const body = Buffer.from(json, "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    this.out.write(Buffer.concat([header, body]));
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (this.buffer.length < start + len) return;
      const body = this.buffer.subarray(start, start + len).toString("utf8");
      this.buffer = this.buffer.subarray(start + len);
      this.dispatch(JSON.parse(body));
    }
  }

  private async dispatch(msg: any) {
    if (msg.id !== undefined && msg.method) {
      // request from peer
      const h = this.handlers.get(msg.method);
      if (!h) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "method not found" },
        });
        return;
      }
      try {
        const result = await h(msg.params);
        this.send({ jsonrpc: "2.0", id: msg.id, result });
      } catch (e: any) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: String(e?.message ?? e) },
        });
      }
    } else if (msg.id !== undefined) {
      // response to our request
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method) {
      // notification
      const h = this.handlers.get(msg.method);
      if (h) {
        try {
          await h(msg.params);
        } catch (e) {
          this.emit("error", e);
        }
      }
    }
  }
}
