import { Scenario } from "@/types";

type Store = { scenarios: Scenario[] };
const g = globalThis as any;
if (!g.__SCENARIO_STORE__) g.__SCENARIO_STORE__ = { scenarios: [] } as Store;
const store: Store = g.__SCENARIO_STORE__;

export function listScenarios() { return store.scenarios; }
export function addScenario(s: Scenario) { store.scenarios.push(s); }
export function getScenarioById(id: string) { return store.scenarios.find(s => s.id === id); }
export function updateScenario(id: string, patch: Partial<Scenario>) {
  const s = getScenarioById(id); if (!s) return false;
  Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  return true;
}
export function deleteScenario(id: string) {
  const i = store.scenarios.findIndex(s => s.id === id);
  if (i === -1) return false;
  store.scenarios.splice(i, 1);
  return true;
}