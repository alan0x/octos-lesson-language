import { RustCourseRuntime, mountRustCourse } from "../../packages/web-runtime/src/rust/adapter.js";
const status = document.querySelector<HTMLElement>("#status")!;
const error = document.querySelector<HTMLElement>("#error")!;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const select = document.querySelector<HTMLSelectElement>("#course")!;
let mounted: ReturnType<typeof mountRustCourse> | undefined;
let runtime: RustCourseRuntime;
async function load(): Promise<void> {
  mounted?.destroy(); mounted = undefined;
  error.textContent = "";
  const response = await fetch(`courses/${select.value}.jsonl`);
  if (!response.ok) throw new Error(`Course HTTP ${response.status}`);
  runtime.request({ command: "load", source: await response.text() });
  mounted = mountRustCourse(viewport, runtime, state => {status.textContent = `${state.projection.status} · ${state.action_cursor}/${state.action_count} · ${state.narration}`;});
}
async function start(): Promise<void> {
  const response = await fetch("oll_runtime.wasm");
  if (!response.ok) throw new Error(`WASM HTTP ${response.status}`);
  runtime = await RustCourseRuntime.create(await response.arrayBuffer());
  await load();
  select.onchange = () => {load().catch(showError);};
  for (const command of ["play", "pause"]) document.querySelector<HTMLButtonElement>(`#${command}`)!.onclick = () => {try {mounted?.command(command);} catch(e) {showError(e);}};
  document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => {load().catch(showError);};
}
function showError(value: unknown): void {error.textContent = value instanceof Error ? value.message : String(value);}
start().catch(showError);
