import type { PlaybackOperation, PlaybackProjection } from "../../../player-core/src/types.js";
import { mountInfiniteBoard, type MountedInfiniteBoard } from "../board-view.js";
interface Exports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  oll_alloc(length: number): number;
  oll_free(pointer: number, length: number): void;
  oll_request(pointer: number, length: number): number;
  oll_response_len(): number;
}
export interface RustSnapshot {
  projection: PlaybackProjection;
  operation?: PlaybackOperation;
  animation?: unknown;
  narration: string;
  action_cursor: number;
  action_count: number;
}
/** One instance owns one session. The existing Web board remains the renderer. */
export class RustCourseRuntime {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  constructor(private readonly exports: Exports) {}
  static async create(bytes: BufferSource): Promise<RustCourseRuntime> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new RustCourseRuntime(instance.exports as Exports);
  }
  request<T = RustSnapshot>(request: Record<string, unknown>): T {
    const bytes = this.encoder.encode(JSON.stringify(request));
    const pointer = this.exports.oll_alloc(bytes.length);
    if (!pointer) throw new Error("Rust runtime input allocation failed");
    let response: { ok: boolean; result: T; error?: string };
    try {
      new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(bytes);
      const output = this.exports.oll_request(pointer, bytes.length);
      response = JSON.parse(this.decoder.decode(new Uint8Array(this.exports.memory.buffer, output, this.exports.oll_response_len())));
    } finally { this.exports.oll_free(pointer, bytes.length); }
    if (!response.ok) throw new Error(response.error ?? "Rust runtime failed");
    return response.result;
  }
}
/** Thin opt-in preview host. No second TypeScript player advances this session. */
export function mountRustCourse(viewport: HTMLElement, runtime: RustCourseRuntime, onState: (state: RustSnapshot) => void): { board: MountedInfiniteBoard; command(command: string, extra?: Record<string, unknown>): RustSnapshot; destroy(): void } {
  const board = mountInfiniteBoard(viewport);
  let frame = 0, last: number | undefined, active = true;
  const render = (state: RustSnapshot): RustSnapshot => { board.view.render(state.projection.board, state.operation); onState(state); return state; };
  const loop = (now: number): void => {
    if (!active) return;
    try { render(runtime.request({ command: "tick", seconds: last === undefined ? 0 : (now - last) / 1000 })); }
    catch (error) { active = false; throw error; }
    last = now; frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  return { board, command: (command, extra = {}) => { last = undefined; return render(runtime.request({ command, ...extra })); }, destroy: () => { active = false; cancelAnimationFrame(frame); board.destroy(); } };
}
