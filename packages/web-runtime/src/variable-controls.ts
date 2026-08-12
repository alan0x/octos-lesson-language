import type { SemanticBoardState } from "../../core/src/index.js";
import type { PlaybackVariableAnimation } from "../../player-core/src/index.js";

export interface VariableControlModel {
  alias: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export function variableControlModels(board: SemanticBoardState | null): VariableControlModel[] {
  if (!board?.variables) return [];
  return Object.entries(board.variables).flatMap(([alias, variable]) => {
    if (variable.control?.kind !== "slider") return [];
    return [{
      alias,
      label: variable.label ?? alias,
      value: variable.value,
      min: variable.min,
      max: variable.max,
      step: variable.control.step ?? (variable.max - variable.min) / 100,
      ...(variable.unit ? { unit: variable.unit } : {}),
    }];
  });
}

export function formatVariableValue(value: number, unit?: string): string {
  if (unit === "rad") {
    const ratio = value / Math.PI;
    const eighths = Math.round(ratio * 8);
    if (Math.abs(ratio * 8 - eighths) < 0.002) {
      if (eighths === 0) return "0";
      const sign = eighths < 0 ? "−" : "";
      const numerator = Math.abs(eighths);
      if (numerator === 8) return `${sign}π`;
      if (numerator % 8 === 0) return `${sign}${numerator / 8}π`;
      const divisor = 8 / greatestCommonDivisor(numerator, 8);
      const reducedNumerator = numerator / greatestCommonDivisor(numerator, 8);
      return reducedNumerator === 1
        ? `${sign}π/${divisor}`
        : `${sign}${reducedNumerator}π/${divisor}`;
    }
  }
  const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(3));
  return unit ? `${rounded} ${unit}` : String(rounded);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export class VariableControlsView {
  private aliases = "";

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: (alias: string, value: number) => void,
  ) {}

  render(
    board: SemanticBoardState | null,
    animation?: PlaybackVariableAnimation,
  ): void {
    const models = variableControlModels(board);
    const aliases = models.map((model) => model.alias).join("|");
    if (aliases !== this.aliases) {
      this.aliases = aliases;
      this.container.replaceChildren(...models.map((model) => this.createControl(model)));
    }
    this.container.hidden = models.length === 0;
    for (const model of models) {
      const control = this.container.querySelector<HTMLElement>(`[data-variable="${model.alias}"]`);
      const input = control?.querySelector<HTMLInputElement>("input");
      const output = control?.querySelector<HTMLOutputElement>("output");
      if (!control || !input || !output) continue;
      input.min = String(model.min);
      input.max = String(model.max);
      input.step = String(model.step);
      input.value = String(model.value);
      output.textContent = formatVariableValue(model.value, model.unit);
      control.classList.toggle("animating", animation?.variable === model.alias);
    }
  }

  private createControl(model: VariableControlModel): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "oll-variable-control";
    wrapper.dataset.variable = model.alias;
    const title = document.createElement("span");
    title.className = "oll-variable-label";
    title.textContent = model.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(model.min);
    input.max = String(model.max);
    input.step = String(model.step);
    input.value = String(model.value);
    input.setAttribute("aria-label", model.label);
    const output = document.createElement("output");
    output.textContent = formatVariableValue(model.value, model.unit);
    input.addEventListener("input", () => this.onChange(model.alias, Number(input.value)));
    wrapper.append(title, input, output);
    return wrapper;
  }
}

export function mountVariableControls(
  container: HTMLElement,
  onChange: (alias: string, value: number) => void,
): VariableControlsView {
  return new VariableControlsView(container, onChange);
}
